function renderSankeyDiagram(container, election, _jurisdiction, widthOverride) {
  if (!election.sankey) {
    container.append("p").text("No Sankey data available for this election.");
    return;
  }
  try {
    if (election.sankey.links.length === 0) {
      renderDonutChart(container, election, widthOverride);
    } else {
      renderSankeyWithLibrary(container, election, widthOverride);
    }
  } catch (error) {
    console.error("Error rendering diagram:", error);
    container.append("p").attr("style", "color: red; font-size: 12px;").text(`Diagram error: ${error.message}`);
  }
}

function renderSankeyWithLibrary(container, election, widthOverride) {
  const { nodes: rawNodes, links: rawLinks, rounds } = election.sankey;
  if (!rawNodes || rawNodes.length === 0) return;

  const winnerName = rounds.find((r) => r.winner)?.winner;

  // Rank candidates by first-round vote count (descending); Exhausted always last
  const round1Tallies = rounds.find((r) => r.stage === 1)?.tallies || {};

  // Filter out write-in candidates, 0-vote candidates, and first-round Exhausted node
  const firstStage = Math.min(...rawNodes.map((n) => n.stage));
  const isExcluded = (n) =>
    (n.name !== "Exhausted" && (
      /write.?in/i.test(n.name) ||
      rounds.every((r) => !r.tallies?.[n.name] || r.tallies[n.name] === 0)
    )) ||
    (n.name === "Exhausted" && n.stage === firstStage);
  const excludedNodeIds = new Set(rawNodes.filter(isExcluded).map((n) => n.id));
  const filteredRawNodes = rawNodes.filter((n) => !excludedNodeIds.has(n.id));
  const filteredRawLinks = rawLinks.filter(
    (l) => !excludedNodeIds.has(l.source) && !excludedNodeIds.has(l.target)
  );

  const stageKeys = [...new Set(filteredRawNodes.map((n) => n.stage))].sort((a, b) => a - b);
  const numStages = stageKeys[stageKeys.length - 1];

  const candidateRank = Object.fromEntries(
    Object.entries(round1Tallies)
      .sort(([, a], [, b]) => b - a)
      .map(([name], i) => [name, i])
  );
  const getRank = (name) => (name === "Exhausted" ? 9999 : (candidateRank[name] ?? 9998));

  // Candidate color palette — sorted by first-round votes descending so top candidates get distinct colors
  const candidateNames = [...new Set(filteredRawNodes.map((n) => n.name).filter((n) => n !== "Exhausted"))]
    .sort((a, b) => (round1Tallies[b] || 0) - (round1Tallies[a] || 0));
  const colorPalette = [
    "#4e8ede", "#e07b39", "#5ab56e", "#c45ec4", "#d4a017",
    "#e05c5c", "#40b9c2", "#9a7dd1", "#b5a040", "#58b09c",
  ];
  const colorScale = d3.scaleOrdinal().domain(candidateNames).range(colorPalette);

  const getNodeColor = (name) => {
    if (name === "Exhausted") return "#666";
    if (name === winnerName) return "#2d8e4e";
    return colorScale(name);
  };

  // Layout dimensions
  const mapEl = document.getElementById("map-container");
  const totalSvgWidth = widthOverride != null ? widthOverride : (mapEl.clientWidth || 960);
  const totalSvgHeight = (mapEl.clientHeight || 600) - 72; // subtract header bar
  const margin = {
    top: 52,
    right: Math.round(totalSvgWidth * 0.2),
    bottom: 24,
    left: Math.round(totalSvgWidth * 0.2),
  };
  const innerWidth = totalSvgWidth - margin.left - margin.right;
  const innerHeight = totalSvgHeight - margin.top - margin.bottom;

  // Build nodes and links for d3-sankey
  const nodeIndexMap = {};
  const sankeyInputNodes = filteredRawNodes.map((n, i) => {
    nodeIndexMap[n.id] = i;
    return { id: n.id, name: n.name, stage: n.stage };
  });

  const sankeyInputLinks = filteredRawLinks.map((l) => ({
    source: nodeIndexMap[l.source],
    target: nodeIndexMap[l.target],
    value: l.value,
    rawValue: l.value,
  }));

  // Run d3-sankey layout
  const sankeyLayout = d3.sankey()
    .nodeWidth(18)
    .nodePadding(14)
    .nodeAlign(d3.sankeyLeft || d3.sankeyJustify)
    .nodeSort((a, b) => getRank(a.name) - getRank(b.name))
    .extent([[0, 0], [innerWidth, innerHeight]]);

  const { nodes: sankeyNodes, links: sankeyLinks } = sankeyLayout({
    nodes: sankeyInputNodes,
    links: sankeyInputLinks,
  });

  // Reorder link entry/exit points so redistributed votes flow in from the closest side.
  // Pass 1 — target side: links from above sources stack at top, from below at bottom.
  sankeyNodes.forEach((node) => {
    if (!node.targetLinks.length) return;
    node.targetLinks.sort((a, b) =>
      (a.source.y0 + a.source.y1) - (b.source.y0 + b.source.y1)
    );
    let y = node.y0;
    node.targetLinks.forEach((link) => {
      link.y1 = y + link.width / 2;
      y += link.width;
    });
  });
  // Pass 2 — source side: links to targets above exit from top, to targets below from bottom.
  sankeyNodes.forEach((node) => {
    if (!node.sourceLinks.length) return;
    node.sourceLinks.sort((a, b) =>
      (a.target.y0 + a.target.y1) - (b.target.y0 + b.target.y1)
    );
    let y = node.y0;
    node.sourceLinks.forEach((link) => {
      link.y0 = y + link.width / 2;
      y += link.width;
    });
  });

  // Build SVG
  const svg = container
    .append("svg")
    .attr("class", "sankey-diagram")
    .attr("viewBox", `0 0 ${totalSvgWidth} ${totalSvgHeight}`)
    .attr("preserveAspectRatio", "xMidYMid meet");

  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  // Stage column header labels
  const stageXPos = {};
  stageKeys.forEach((stage) => {
    const nodesInStage = sankeyNodes.filter((n) => n.stage === stage);
    stageXPos[stage] = d3.mean(nodesInStage, (n) => (n.x0 + n.x1) / 2);
  });

  // Decide which stage labels to show: always Round 1 and Final; greedily insert others without overlap
  const minLabelSpacing = 72; // approximate px width of "ROUND XX" at 12px
  const visibleStageLabels = new Set([stageKeys[0], numStages]);
  let lastShownX = stageXPos[stageKeys[0]];
  for (let i = 1; i < stageKeys.length - 1; i++) {
    const stage = stageKeys[i];
    const x = stageXPos[stage];
    if (x - lastShownX >= minLabelSpacing && stageXPos[numStages] - x >= minLabelSpacing) {
      visibleStageLabels.add(stage);
      lastShownX = x;
    }
  }

  g.selectAll(".stage-label")
    .data(stageKeys)
    .join("text")
    .attr("class", "stage-label")
    .attr("x", (stage) => stageXPos[stage])
    .attr("y", -18)
    .attr("text-anchor", "middle")
    .attr("font-size", "12px")
    .attr("fill", "var(--text-dim)")
    .attr("font-weight", "600")
    .attr("letter-spacing", "0.08em")
    .text((stage) => {
      if (!visibleStageLabels.has(stage)) return "";
      return stage === numStages ? "FINAL" : `ROUND ${stage}`;
    });

  // Links
  const linkPathGen = d3.sankeyLinkHorizontal();
  g.append("g")
    .attr("fill", "none")
    .selectAll(".sankey-link")
    .data(sankeyLinks)
    .join("path")
    .attr("class", "sankey-link")
    .attr("d", linkPathGen)
    .attr("stroke", (d) => getNodeColor(d.source.name))
    .attr("stroke-width", (d) => Math.max(1, d.width))
    .attr("stroke-opacity", 0.32)
    .style("pointer-events", "visibleStroke")
    .on("mouseenter", function (event, d) {
      d3.select(this).attr("stroke-opacity", 0.65);
      tooltip
        .html(`<strong>${formatPersonName(d.source.name)} → ${formatPersonName(d.target.name)}</strong><br>${d3.format(",d")(d.rawValue)} votes`)
        .style("opacity", 1);
      positionTooltip(event);
    })
    .on("mousemove", function (event) { positionTooltip(event); })
    .on("mouseleave", function () {
      d3.select(this).attr("stroke-opacity", 0.32);
      hideTooltip();
    });

  // Node rectangles
  const visibleNodes = sankeyNodes;

  g.append("g")
    .selectAll(".sankey-node")
    .data(visibleNodes)
    .join("rect")
    .attr("class", "sankey-node")
    .attr("x", (d) => d.x0)
    .attr("y", (d) => d.y0)
    .attr("width", (d) => d.x1 - d.x0)
    .attr("height", (d) => Math.max(2, d.y1 - d.y0))
    .attr("fill", (d) => getNodeColor(d.name))
    .attr("rx", 2)
    .attr("opacity", (d) => (d.name === "Exhausted" ? 0.45 : 0.88))
    .on("mouseenter", function (event, d) {
      d3.select(this).attr("opacity", 1);
      const roundData = rounds.find((r) => r.stage === d.stage);
      const isExhaustedNode = d.name === "Exhausted";
      const votes = isExhaustedNode ? roundData?.exhausted : roundData?.tallies?.[d.name];
      const roundLabel = d.stage === numStages ? "Final" : `Round ${d.stage}`;
      tooltip
        .html(votes != null
          ? isExhaustedNode
            ? `<strong>Exhausted: ${d3.format(",d")(votes)} votes</strong><br><span style="font-size:12px;color:var(--text-dim)">Ballots with no remaining ranked candidates.</span>`
            : `<strong>${formatPersonName(d.name)}</strong><br>${roundLabel}: ${d3.format(",d")(votes)} votes`
          : `<strong>${formatPersonName(d.name)}</strong>`)
        .style("opacity", 1);
      positionTooltip(event);
    })
    .on("mousemove", function (event) { positionTooltip(event); })
    .on("mouseleave", function (_event, d) {
      d3.select(this).attr("opacity", d.name === "Exhausted" ? 0.45 : 0.88);
      hideTooltip();
    });

  // Node labels: first stage on left, last stage on right
  const labelLayer = g.append("g").attr("font-family", "var(--font-sans, sans-serif)");

  const lineH = 14;

  function wrapName(name, maxChars) {
    const words = name.split(" ");
    const lines = [];
    let cur = "";
    words.forEach((w) => {
      const candidate = cur ? `${cur} ${w}` : w;
      if (candidate.length > maxChars && cur) {
        lines.push(cur);
        cur = w;
      } else {
        cur = candidate;
      }
    });
    if (cur) lines.push(cur);
    return lines;
  }

  visibleNodes.forEach((d) => {
    const isFirst = d.stage === stageKeys[0];
    const isLast = d.stage === numStages;
    const isExhausted = d.name === "Exhausted";
    if (!isFirst && !isLast && !isExhausted) return;

    const midY = (d.y0 + d.y1) / 2;
    const isWinner = d.name === winnerName && isLast;
    const x = isFirst ? d.x0 - 10 : d.x1 + 10;
    const anchor = isFirst ? "end" : "start";

    // Candidate name — first stage on left, last stage on right
    // Exhausted in intermediate stages gets no name (count alone is enough)
    if (isFirst || isLast) {
      const prefix = isWinner ? "★ " : "";
      const nodeVotes = rounds.find((r) => r.stage === d.stage)?.tallies?.[d.name];
      const wrapLimit = (nodeVotes != null && nodeVotes < 3000) ? Infinity : 14;
      const lines = wrapName(prefix + formatPersonName(d.name), wrapLimit);
      const anchorY = midY - (isLast ? 8 : 0);
      const startY = anchorY - (lines.length - 1) * lineH / 2;

      const textEl = labelLayer.append("text")
        .attr("text-anchor", anchor)
        .attr("font-size", "13px")
        .attr("fill", isWinner ? "#4ade80" : "var(--text)")
        .attr("font-weight", isWinner ? "700" : "400");

      lines.forEach((line, i) => {
        textEl.append("tspan")
          .attr("x", x)
          .attr("y", startY + i * lineH)
          .attr("dominant-baseline", "middle")
          .text(line);
      });
    }

    // Vote count: last-stage nodes (below name) + Exhausted in every stage
    if (isLast || isExhausted) {
      const roundData = rounds.find((r) => r.stage === d.stage);
      const votes = roundData?.tallies?.[d.name];
      if (votes != null) {
        const namePrefix = isWinner ? "★ " : "";
        const voteWrapLimit = (votes != null && votes < 1000) ? Infinity : 14;
        const lines = isLast ? wrapName(namePrefix + formatPersonName(d.name), voteWrapLimit) : [];
        const anchorY = midY - (isLast ? 8 : 0);
        const bottomOfName = anchorY + (lines.length - 1) * lineH / 2;
        labelLayer
          .append("text")
          .attr("x", d.x1 + 10)
          .attr("y", isLast ? bottomOfName + lineH + 4 : midY)
          .attr("text-anchor", "start")
          .attr("dominant-baseline", "middle")
          .attr("font-size", "11px")
          .attr("fill", "var(--text-dim)")
          .text(d3.format(",d")(votes));
      }
    }
  });
}

function renderDonutChart(container, election, widthOverride) {
  const { rounds } = election.sankey;
  const winnerName = rounds.find((r) => r.winner)?.winner;
  const tallies = rounds[0]?.tallies || {};

  // Sort candidates by votes descending; Exhausted always last
  const data = Object.entries(tallies).sort(([nameA, a], [nameB, b]) => {
    if (nameA === "Exhausted") return 1;
    if (nameB === "Exhausted") return -1;
    return b - a;
  });
  if (data.length === 0) return;

  const totalVotes = d3.sum(data, ([, v]) => v);

  // Dimensions — same sizing as the Sankey
  const mapEl = document.getElementById("map-container");
  const totalSvgWidth = widthOverride != null ? widthOverride : (mapEl.clientWidth || 960);
  const totalSvgHeight = (mapEl.clientHeight || 600) - 72;
  const cx = totalSvgWidth / 2;
  const cy = totalSvgHeight / 2;
  const outerRadius = Math.min(cx, cy) * 0.52;
  const innerRadius = outerRadius * 0.54;
  const labelR = outerRadius * 1.22;

  // Color palette — same as Sankey
  const candidateNames = data.map(([n]) => n).filter((n) => n !== "Exhausted");
  const colorPalette = [
    "#4e8ede", "#e07b39", "#5ab56e", "#c45ec4", "#d4a017",
    "#e05c5c", "#40b9c2", "#9a7dd1", "#b5a040", "#58b09c",
  ];
  const colorScale = d3.scaleOrdinal().domain(candidateNames).range(colorPalette);
  const getColor = (name) => {
    if (name === "Exhausted") return "#666";
    if (name === winnerName) return "#2d8e4e";
    return colorScale(name);
  };

  const svg = container
    .append("svg")
    .attr("class", "sankey-diagram")
    .attr("viewBox", `0 0 ${totalSvgWidth} ${totalSvgHeight}`)
    .attr("preserveAspectRatio", "xMidYMid meet");

  const g = svg.append("g").attr("transform", `translate(${cx},${cy})`);

  // Arc generators
  const arc = d3.arc().innerRadius(innerRadius).outerRadius(outerRadius).padAngle(0.018).cornerRadius(3);

  const pie = d3.pie().value(([, v]) => v).sort(null);
  const arcs = pie(data);

  // Segments
  g.selectAll(".donut-segment")
    .data(arcs)
    .join("path")
    .attr("class", "donut-segment")
    .attr("d", arc)
    .attr("fill", (d) => getColor(d.data[0]))
    .attr("opacity", (d) => (d.data[0] === "Exhausted" ? 0.45 : 0.88))
    .attr("stroke", "rgba(10,14,20,0.35)")
    .attr("stroke-width", 1)
    .on("mouseenter", function () { d3.select(this).attr("opacity", 1); })
    .on("mouseleave", (event, d) => {
      d3.select(event.currentTarget).attr("opacity", d.data[0] === "Exhausted" ? 0.45 : 0.88);
    })
    .append("title")
    .text((d) => `${d.data[0]}: ${d3.format(",d")(d.data[1])} votes (${(d.data[1] / totalVotes * 100).toFixed(1)}%)`);

  // Labels with leader lines — skip very small segments
  const minLabelAngle = 0.12; // radians
  arcs.forEach((d) => {
    const span = d.endAngle - d.startAngle;
    if (span < minLabelAngle) return;

    const [name, votes] = d.data;
    const mid = (d.startAngle + d.endAngle) / 2;
    const isRight = mid < Math.PI;

    // Points: outer arc edge → elbow at labelR → horizontal end
    const outerPt = [Math.sin(mid) * outerRadius, -Math.cos(mid) * outerRadius];
    const elbowPt = [Math.sin(mid) * labelR, -Math.cos(mid) * labelR];
    const endPt = [(isRight ? 1 : -1) * (labelR + 14), elbowPt[1]];

    const maxChars = 26;
    const label = name.length > maxChars ? name.substring(0, maxChars - 1) + "…" : name;
    const pct = (votes / totalVotes * 100).toFixed(1);
    const isWinner = name === winnerName;

    g.append("polyline")
      .attr("fill", "none")
      .attr("stroke", getColor(name))
      .attr("stroke-width", 1.2)
      .attr("stroke-opacity", 0.55)
      .attr("points", [outerPt, elbowPt, endPt].map((p) => p.join(",")).join(" "));

    g.append("text")
      .attr("x", endPt[0] + (isRight ? 5 : -5))
      .attr("y", endPt[1] - 7)
      .attr("text-anchor", isRight ? "start" : "end")
      .attr("dominant-baseline", "middle")
      .attr("font-size", "13px")
      .attr("font-family", "var(--font-sans, sans-serif)")
      .attr("fill", isWinner ? "#4ade80" : "var(--text)")
      .attr("font-weight", isWinner ? "700" : "400")
      .text(isWinner ? `★ ${label}` : label);

    g.append("text")
      .attr("x", endPt[0] + (isRight ? 5 : -5))
      .attr("y", endPt[1] + 9)
      .attr("text-anchor", isRight ? "start" : "end")
      .attr("dominant-baseline", "middle")
      .attr("font-size", "11px")
      .attr("font-family", "var(--font-sans, sans-serif)")
      .attr("fill", "var(--text-dim)")
      .text(`${d3.format(",d")(votes)}  ·  ${pct}%`);
  });

  // Center label
  g.append("text")
    .attr("text-anchor", "middle")
    .attr("y", -innerRadius * 0.42)
    .attr("font-size", "9px")
    .attr("font-family", "var(--font-sans, sans-serif)")
    .attr("font-weight", "600")
    .attr("letter-spacing", "0.08em")
    .attr("fill", "var(--text-dim)")
    .text("FIRST ROUND MAJORITY");

  g.append("text")
    .attr("text-anchor", "middle")
    .attr("y", -innerRadius * 0.25)
    .attr("font-size", "11px")
    .attr("font-family", "var(--font-sans, sans-serif)")
    .attr("font-weight", "600")
    .attr("letter-spacing", "0.08em")
    .attr("fill", "var(--text-dim)")
    .text("WINNER");

  const winnerLabel = winnerName || "";
  const winnerLines = winnerLabel.length > 18
    ? [winnerLabel.substring(0, winnerLabel.lastIndexOf(" ", 18) || 18), winnerLabel.substring(winnerLabel.lastIndexOf(" ", 18) + 1)]
    : [winnerLabel];

  winnerLines.forEach((line, i) => {
    g.append("text")
      .attr("text-anchor", "middle")
      .attr("y", innerRadius * 0.1 + i * 20)
      .attr("font-size", "15px")
      .attr("font-family", "var(--font-sans, sans-serif)")
      .attr("font-weight", "700")
      .attr("fill", "#4ade80")
      .text(line);
  });

  if (winnerName) {
    const winnerVotes = tallies[winnerName] || 0;
    g.append("text")
      .attr("text-anchor", "middle")
      .attr("y", innerRadius * 0.1 + winnerLines.length * 20 + 14)
      .attr("font-size", "11px")
      .attr("font-family", "var(--font-sans, sans-serif)")
      .attr("fill", "var(--text-dim)")
      .text(`${(winnerVotes / totalVotes * 100).toFixed(1)}% of votes`);
  }
}

function parsePairwiseBeats(notes) {
  // Returns { "A": { "B": ratio, ... }, ... } from notes like "X over others -> A:50.5%, B:87.4%;"
  const beats = {};
  const sectionRe = /([A-Za-z][A-Za-z .'-]+?) over others\s*->\s*([^;]+)/g;
  let m;
  while ((m = sectionRe.exec(notes)) !== null) {
    const winner = m[1].trim();
    if (!beats[winner]) beats[winner] = {};
    const pairRe = /([A-Za-z][A-Za-z .'-]+?):\s*(\d+\.?\d*)%/g;
    let p;
    while ((p = pairRe.exec(m[2])) !== null) {
      beats[winner][p[1].trim()] = parseFloat(p[2]) / 100;
    }
  }
  return beats;
}

function findCycleTriple(beats) {
  const candidates = Object.keys(beats);
  for (let i = 0; i < candidates.length; i++) {
    for (let j = 0; j < candidates.length; j++) {
      if (j === i || !(beats[candidates[i]]?.[candidates[j]] > 0.5)) continue;
      for (let k = 0; k < candidates.length; k++) {
        if (k === i || k === j) continue;
        if (!(beats[candidates[j]]?.[candidates[k]] > 0.5)) continue;
        if (!(beats[candidates[k]]?.[candidates[i]] > 0.5)) continue;
        return [candidates[i], candidates[j], candidates[k]];
      }
    }
  }
  return null;
}

function renderCondorcetWinnerPanel(container, election) {
  const match = election.notes.match(/Condorcet winner:\s*([^.]+)/);
  const condorcetWinner = match ? match[1].trim() : null;

  container.append("h3").attr("class", "cycle-panel-title").text("The Condorcet Winner");
  container.append("p").attr("class", "cycle-panel-desc")
    .text("This candidate would have beaten every other candidate in a head-to-head matchup, but was eliminated before the final round.");

  if (!condorcetWinner) return;

  const allCandidates = [...new Set(election.sankey.nodes.map((n) => n.name))]
    .filter((n) => n !== "Exhausted");
  const opponents = allCandidates.filter((n) => n !== condorcetWinner);
  const pv = election.pairwiseVotes;

  const topPad = 22, bottomPad = 22, rowH = 62;
  const w = 400;
  const h = topPad + opponents.length * rowH + bottomPad;
  const trunkX = 110;
  const branchEndX = 262;
  const oppNameX = 270;
  const winnerCY = h / 2;

  const oppRows = opponents.map((name, i) => ({
    name,
    y: topPad + i * rowH + rowH / 2,
  }));
  const topY = oppRows[0].y;
  const bottomY = oppRows[oppRows.length - 1].y;

  const svg = container.append("svg")
    .attr("class", "cycle-fullscreen-svg")
    .attr("viewBox", `0 0 ${w} ${h}`)
    .attr("preserveAspectRatio", "xMidYMid meet");

  svg.append("defs").append("marker")
    .attr("id", "winner-arrow")
    .attr("viewBox", "0 -5 10 10")
    .attr("refX", 10).attr("refY", 0)
    .attr("markerWidth", 7).attr("markerHeight", 7)
    .attr("orient", "auto")
    .append("path").attr("d", "M0,-5L10,0L0,5").attr("fill", COLORS.yellow);

  // Horizontal leader from winner name to trunk
  svg.append("line")
    .attr("x1", trunkX - 10).attr("y1", winnerCY)
    .attr("x2", trunkX).attr("y2", winnerCY)
    .attr("stroke", COLORS.yellow).attr("stroke-width", 1.5).attr("stroke-opacity", 0.6);

  // Vertical trunk spanning all opponent rows
  if (opponents.length > 1) {
    svg.append("line")
      .attr("x1", trunkX).attr("y1", topY)
      .attr("x2", trunkX).attr("y2", bottomY)
      .attr("stroke", COLORS.yellow).attr("stroke-width", 1.5).attr("stroke-opacity", 0.6);
  }

  // Branches to each opponent
  oppRows.forEach((opp) => {
    const wVotes = pv?.[condorcetWinner]?.[opp.name];
    const oVotes = pv?.[opp.name]?.[condorcetWinner];
    const beatsText = (wVotes != null && oVotes != null)
      ? `Beats, ${d3.format(",d")(wVotes)} to ${d3.format(",d")(oVotes)}`
      : "Beats";

    svg.append("line")
      .attr("x1", trunkX).attr("y1", opp.y)
      .attr("x2", branchEndX).attr("y2", opp.y)
      .attr("stroke", COLORS.yellow).attr("stroke-width", 1.5).attr("stroke-opacity", 0.6)
      .attr("marker-end", "url(#winner-arrow)");

    svg.append("text")
      .attr("x", (trunkX + branchEndX) / 2).attr("y", opp.y - 7)
      .attr("text-anchor", "middle").attr("font-size", "10px")
      .attr("fill", "var(--text)").attr("opacity", 0.85)
      .text(beatsText);

    svg.append("text")
      .attr("x", oppNameX).attr("y", opp.y)
      .attr("dominant-baseline", "middle").attr("font-size", "13px")
      .attr("fill", "var(--text)").attr("font-weight", "500")
      .text(formatPersonName(opp.name));
  });

  // Winner name — right-aligned into the trunk
  const winnerWords = formatPersonName(condorcetWinner).split(" ");
  const winnerLines = [];
  let cur = "";
  winnerWords.forEach((word) => {
    const candidate = cur ? `${cur} ${word}` : word;
    if (candidate.length > 12 && cur) { winnerLines.push(cur); cur = word; }
    else { cur = candidate; }
  });
  if (cur) winnerLines.push(cur);

  winnerLines.forEach((line, i) => {
    svg.append("text")
      .attr("x", trunkX - 14)
      .attr("y", winnerCY + (i - (winnerLines.length - 1) / 2) * 17)
      .attr("text-anchor", "end").attr("dominant-baseline", "middle")
      .attr("font-size", "14px").attr("fill", COLORS.yellow).attr("font-weight", "600")
      .text(line);
  });
}

function renderCondorcetCycle(container, election) {
  const beats = parsePairwiseBeats(election.notes);
  const cycleTriple = findCycleTriple(beats);
  const nodeLabels = cycleTriple || ["Candidate A", "Candidate B", "Candidate C"];

  container.append("h3").attr("class", "cycle-panel-title").text("The Condorcet Cycle");
  container.append("p").attr("class", "cycle-panel-desc")
    .text("Each arrow shows a head-to-head majority preference. These preferences loop, so no single candidate beats all others.");

  const mapEl = document.getElementById("map-container");
  const panelH = (mapEl.clientHeight || 600) - 72;
  const w = 420;
  const h = Math.min(panelH - 80, 400); // leave room for the text above

  const cx = w / 2;
  const cy = h * 0.5;
  const triR = Math.min(w, h) * 0.32;
  const nodeR = 46;

  const positions = [
    { x: cx, y: cy - triR },
    { x: cx - triR * Math.sin(2 * Math.PI / 3), y: cy - triR * Math.cos(2 * Math.PI / 3) },
    { x: cx + triR * Math.sin(2 * Math.PI / 3), y: cy - triR * Math.cos(2 * Math.PI / 3) },
  ];

  const nodes = nodeLabels.map((label, i) => ({ label, ...positions[i] }));

  const svg = container.append("svg")
    .attr("class", "cycle-fullscreen-svg")
    .attr("viewBox", `0 0 ${w} ${h}`)
    .attr("preserveAspectRatio", "xMidYMid meet");

  svg.append("defs").append("marker")
    .attr("id", "fs-cycle-arrow")
    .attr("viewBox", "0 -5 10 10")
    .attr("refX", 10)
    .attr("refY", 0)
    .attr("markerWidth", 7)
    .attr("markerHeight", 7)
    .attr("orient", "auto")
    .append("path")
    .attr("d", "M0,-5L10,0L0,5")
    .attr("fill", COLORS.purple);

  // Draw curved arrows: 0→1, 1→2, 2→0
  [[0, 1], [1, 2], [2, 0]].forEach(([si, ti]) => {
    const s = nodes[si];
    const t = nodes[ti];
    const dx = t.x - s.x;
    const dy = t.y - s.y;
    const dist = Math.hypot(dx, dy);
    const ux = dx / dist;
    const uy = dy / dist;

    const startX = s.x + ux * nodeR;
    const startY = s.y + uy * nodeR;
    const endX = t.x - ux * (nodeR + 14);
    const endY = t.y - uy * (nodeR + 14);

    // Curve control point: offset perpendicular to the link
    const mx = (startX + endX) / 2;
    const my = (startY + endY) / 2;
    const curve = dist * 0.18;
    const cpx = mx - uy * curve;
    const cpy = my + ux * curve;

    svg.append("path")
      .attr("fill", "none")
      .attr("stroke", COLORS.purple)
      .attr("stroke-width", 2.5)
      .attr("stroke-opacity", 0.75)
      .attr("d", `M${startX},${startY} Q${cpx},${cpy} ${endX},${endY}`)
      .attr("marker-end", "url(#fs-cycle-arrow)");

    // "Beats" label near the midpoint of the curve
    const lx = (startX + endX) / 2 - uy * curve * 1.4;
    const ly = (startY + endY) / 2 + ux * curve * 1.4;
    const pvA = election.pairwiseVotes?.[s.label]?.[t.label];
    const pvB = election.pairwiseVotes?.[t.label]?.[s.label];
    const countStr = (pvA != null && pvB != null)
      ? `${d3.format(",d")(pvA)} to ${d3.format(",d")(pvB)}` : null;
    const beatsEl = svg.append("text")
      .attr("text-anchor", "middle")
      .attr("font-size", "12px")
      .attr("fill", "var(--text)")
      .attr("opacity", 0.85);
    beatsEl.append("tspan")
      .attr("x", lx).attr("y", ly - (countStr ? 6 : 0))
      .attr("dominant-baseline", "middle")
      .text("Beats");
    if (countStr) {
      beatsEl.append("tspan")
        .attr("x", lx).attr("dy", "1.3em")
        .attr("dominant-baseline", "middle")
        .attr("font-size", "10px")
        .text(countStr);
    }
  });

  // Node circles and labels
  nodes.forEach((node) => {
    svg.append("circle")
      .attr("cx", node.x)
      .attr("cy", node.y)
      .attr("r", nodeR)
      .attr("fill", "rgba(123, 63, 160, 0.12)")
      .attr("stroke", COLORS.purple)
      .attr("stroke-width", 1.5);

    // Wrap name into two lines where possible (~14 chars per line)
    const words = formatPersonName(node.label).split(" ");
    const lines = [];
    let cur = "";
    words.forEach((w) => {
      const candidate = cur ? `${cur} ${w}` : w;
      if (candidate.length > 14 && cur) {
        lines.push(cur);
        cur = w;
      } else {
        cur = candidate;
      }
    });
    if (cur) lines.push(cur);

    const lineH = 17;
    lines.forEach((line, i) => {
      svg.append("text")
        .attr("x", node.x)
        .attr("y", node.y + (i - (lines.length - 1) / 2) * lineH)
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "middle")
        .attr("font-size", "14px")
        .attr("fill", "var(--text)")
        .attr("font-weight", "500")
        .text(line);
    });
  });
}

function renderPairwiseComparison(container, election) {
  if (!election.pairwiseRatios) {
    container.append("p").text("No pairwise data available for this election.");
    return;
  }

  const candidates = Object.keys(election.pairwiseRatios);
  const gridSize = Math.max(60, Math.min(100, 600 / candidates.length));
  const gap = 10;
  const cellSize = gridSize - gap;

  container.append("h4").attr("class", "analysis-subtitle").text("Head-to-Head Matchups");

  const svg = container
    .append("svg")
    .attr("class", "pairwise-grid")
    .attr("viewBox", `0 0 ${(candidates.length) * gridSize + gap} ${(candidates.length) * gridSize + gap}`)
    .attr("preserveAspectRatio", "xMidYMid meet");

  // Draw grid of matchups
  candidates.forEach((candidate1, i) => {
    candidates.forEach((candidate2, j) => {
      const x = i * gridSize;
      const y = j * gridSize;

      if (i === j) {
        // Diagonal - show candidate name
        svg
          .append("rect")
          .attr("class", "pairwise-cell diagonal")
          .attr("x", x + gap / 2)
          .attr("y", y + gap / 2)
          .attr("width", cellSize)
          .attr("height", cellSize)
          .attr("fill", "rgba(200, 200, 200, 0.1)")
          .attr("stroke", "var(--rule)")
          .attr("stroke-width", 1);

        svg
          .append("text")
          .attr("class", "pairwise-label")
          .attr("x", x + gridSize / 2)
          .attr("y", y + gridSize / 2)
          .attr("text-anchor", "middle")
          .attr("dominant-baseline", "middle")
          .attr("font-size", "11px")
          .attr("fill", "var(--text)")
          .attr("font-weight", "600")
          .text(candidate1.substring(0, 15));
      } else if (i < j) {
        // Upper triangle - show matchup
        const ratio = election.pairwiseRatios[candidate1][candidate2];

        svg
          .append("rect")
          .attr("class", "pairwise-cell")
            .attr("x", x + gap / 2)
            .attr("y", y + gap / 2)
            .attr("width", cellSize)
            .attr("height", cellSize)
            .attr("fill", ratio > 0.5 ? "rgba(76, 222, 128, 0.2)" : "rgba(239, 68, 68, 0.2)")
            .attr("stroke", "var(--rule)")
            .attr("stroke-width", 1);

        const percentage = (ratio * 100).toFixed(0);
        svg
          .append("text")
          .attr("class", "pairwise-text")
          .attr("x", x + gridSize / 2)
          .attr("y", y + gridSize / 2 - 8)
          .attr("text-anchor", "middle")
          .attr("dominant-baseline", "middle")
          .attr("font-size", "13px")
          .attr("fill", "var(--text)")
          .attr("font-weight", "700")
          .text(`${percentage}%`);

        svg
          .append("text")
          .attr("class", "pairwise-sublabel")
          .attr("x", x + gridSize / 2)
          .attr("y", y + gridSize / 2 + 12)
          .attr("text-anchor", "middle")
          .attr("dominant-baseline", "middle")
          .attr("font-size", "9px")
          .attr("fill", "var(--text-dim)")
          .text(candidate1.substring(0, 8));
      }
      // Lower triangle is empty
    });
  });
}

function jurisdictionTitle(jurisdiction) {
  const fullState = stateName(jurisdiction.state);
  if (jurisdiction.city === fullState) return fullState;
  return `${jurisdiction.city}, ${fullState}`;
}

function electionCardPreview(election) {
  const rounds = election.sankey?.rounds;
  if (!rounds?.length) return "";
  const r1 = rounds.find((r) => r.stage === 1);
  if (!r1) return "";
  const tallies = r1.tallies || {};
  const candidates = Object.keys(tallies).filter((n) => !/write.?in/i.test(n) && tallies[n] > 0);
  const totalVotes = Object.values(tallies).reduce((s, v) => s + v, 0) + (r1.exhausted || 0);
  const winner = rounds.find((r) => r.winner)?.winner;
  const parts = [];
  if (winner) parts.push(`Winner: ${formatPersonName(winner)}`);
  if (totalVotes) parts.push(`${d3.format(",d")(totalVotes)} votes`);
  if (candidates.length) parts.push(`${candidates.length} candidate${candidates.length === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

function buildElectionCardsHtml(jurisdiction, sort = { mode: "priority", dir: -1 }) {
  const { mode, dir } = sort;
  const withIdx = jurisdiction.elections
    .map((election, idx) => ({ election, idx }))
    .filter(({ election }) => activeFilters.has(election.condorcet));

  const naturalOffice = (e) => formatOfficeLabel(e.office);
  const getVotes = (e) => {
    const r1 = e.sankey?.rounds?.find((r) => r.stage === 1);
    return r1 ? Object.values(r1.tallies || {}).reduce((s, v) => s + v, 0) + (r1.exhausted || 0) : 0;
  };
  const getCandidates = (e) => {
    const r1 = e.sankey?.rounds?.find((r) => r.stage === 1);
    return r1 ? Object.keys(r1.tallies || {}).filter((n) => !/write.?in/i.test(n) && r1.tallies[n] > 0).length : 0;
  };

  const tiebreak = (a, b) =>
    naturalOffice(a.election).localeCompare(naturalOffice(b.election), undefined, { numeric: true })
    || (a.election.year || 0) - (b.election.year || 0);

  const sorted = withIdx.sort((a, b) => {
    if (mode === "year") {
      return dir * ((a.election.year || 0) - (b.election.year || 0))
        || naturalOffice(a.election).localeCompare(naturalOffice(b.election), undefined, { numeric: true });
    }
    if (mode === "candidates") {
      return dir * (getCandidates(a.election) - getCandidates(b.election)) || tiebreak(a, b);
    }
    if (mode === "turnout") {
      return dir * (getVotes(a.election) - getVotes(b.election)) || tiebreak(a, b);
    }
    // priority: interesting results first by default (dir=-1 → high priority first)
    const rank = (c) => PRIORITY[c] ?? 0;
    return dir * (rank(a.election.condorcet) - rank(b.election.condorcet)) || tiebreak(a, b);
  });

  const cardsHtml = sorted
    .map(
      ({ election, idx }) => `
    <div class="election-card" data-election-index="${idx}">
      <div class="election-card-header">
        <span class="election-card-dot" style="background: ${COLORS[election.condorcet]}"></span>
        <div class="election-card-title">
          <div class="election-card-year">${election.year}</div>
          <div class="election-card-office">${formatOfficeLabel(election.office)}</div>
        </div>
      </div>
      <div class="election-card-category">${LABELS[election.condorcet]}</div>
      <div class="election-card-preview">${electionCardPreview(election)}</div>
    </div>
  `
    )
    .join("");

  const sortModes = [
    { key: "priority", label: "Condorcet Effects" },
    { key: "year", label: "Year" },
    { key: "candidates", label: "# of Candidates" },
    { key: "turnout", label: "Voter Turnout" },
  ];
  const arrow = dir === 1 ? " ↑" : " ↓";
  const sortBarHtml = `<div class="election-sort-bar"><span class="election-sort-label">Sort by:</span>${sortModes.map((m) => {
    const isActive = mode === m.key;
    return `<button type="button" class="election-sort-btn${isActive ? " active" : ""}" data-sort="${m.key}">${m.label}${isActive ? arrow : ""}</button>`;
  }).join("")}</div>`;

  return `
    <div class="elections-list-view">
      <h3 class="jurisdiction-title">${jurisdictionTitle(jurisdiction)}</h3>
      ${sortBarHtml}
      <div class="elections-grid">
        ${cardsHtml}
      </div>
    </div>
  `;
}

function openSankeyView(jurisdiction, electionIndex) {
  const election = jurisdiction.elections[electionIndex];

  sankeyFsTitle.text(`${election.year} ${formatOfficeLabel(election.office)} · ${jurisdiction.city}, ${stateName(jurisdiction.state)}`);
  sankeyFsCategory.text(LABELS[election.condorcet]).style("color", COLORS[election.condorcet]);

  sankeyFsBody.html("");

  if (election.condorcet === "purple" || election.condorcet === "yellow") {
    const split = sankeyFsBody.append("div").attr("class", "sankey-fs-split");
    const leftWrap = split.append("div").attr("class", "sankey-fs-split-left");
    const rightWrap = split.append("div").attr("class", "sankey-fs-split-right");
    const mapEl = document.getElementById("map-container");
    const sankeyWidth = Math.floor((mapEl.clientWidth || 960) * 0.6);
    renderSankeyDiagram(leftWrap, election, jurisdiction, sankeyWidth);
    if (election.condorcet === "purple") {
      renderCondorcetCycle(rightWrap, election);
    } else {
      renderCondorcetWinnerPanel(rightWrap, election);
    }
  } else {
    const diagramWrap = sankeyFsBody.append("div").attr("class", "sankey-fs-diagram-wrap");
    renderSankeyDiagram(diagramWrap, election, jurisdiction);
  }

  sankeyFullscreen.attr("hidden", null);
}
