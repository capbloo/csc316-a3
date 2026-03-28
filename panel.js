function extractCycleNodesFromNotes(notes) {
  const match = notes.match(
    /([A-Za-z][A-Za-z .'-]+?)\s*>\s*([A-Za-z][A-Za-z .'-]+?)\s*>\s*([A-Za-z][A-Za-z .'-]+?)\s*>\s*([A-Za-z][A-Za-z .'-]+?)(?:\.|,|$)/
  );

  if (!match) {
    return null;
  }

  const first = match[1].trim();
  const second = match[2].trim();
  const third = match[3].trim();
  const fourth = match[4].trim();

  if (first !== fourth) {
    return null;
  }

  return [first, second, third];
}

function renderCycleVisualization(container, jurisdiction, selectedElection) {
  let nodeLabels = null;

  if (selectedElection && selectedElection.notes.includes(">")) {
    nodeLabels = extractCycleNodesFromNotes(selectedElection.notes);
  }

  if (!nodeLabels) {
    const cycleElection = jurisdiction.elections.find(
      (election) => election.condorcet === "purple" && election.notes.includes(">")
    );
    nodeLabels = cycleElection ? extractCycleNodesFromNotes(cycleElection.notes) : null;
  }

  nodeLabels = nodeLabels || ["Candidate A", "Candidate B", "Candidate C"];

  container.append("h4").attr("class", "analysis-subtitle").text("Condorcet Cycle");

  const chart = container
    .append("svg")
    .attr("class", "cycle-chart")
    .attr("viewBox", "0 0 360 210")
    .attr("preserveAspectRatio", "xMidYMid meet");

  chart
    .append("defs")
    .append("marker")
    .attr("id", "cycle-arrow")
    .attr("viewBox", "0 -5 10 10")
    .attr("refX", 12)
    .attr("refY", 0)
    .attr("markerWidth", 6)
    .attr("markerHeight", 6)
    .attr("orient", "auto")
    .append("path")
    .attr("d", "M0,-5L10,0L0,5")
    .attr("fill", COLORS.purple);

  const positions = [
    { x: 180, y: 36 },
    { x: 78, y: 160 },
    { x: 282, y: 160 },
  ];

  const nodes = nodeLabels.map((label, index) => ({
    label,
    ...positions[index],
  }));

  const links = [
    { source: nodes[0], target: nodes[1] },
    { source: nodes[1], target: nodes[2] },
    { source: nodes[2], target: nodes[0] },
  ];

  chart
    .append("g")
    .selectAll("path.cycle-link")
    .data(links)
    .join("path")
    .attr("class", "cycle-link")
    .attr("d", (d) => `M${d.source.x},${d.source.y} L${d.target.x},${d.target.y}`)
    .attr("marker-end", "url(#cycle-arrow)");

  const nodeGroup = chart
    .append("g")
    .selectAll("g.cycle-node")
    .data(nodes)
    .join("g")
    .attr("class", "cycle-node")
    .attr("transform", (d) => `translate(${d.x}, ${d.y})`);

  nodeGroup
    .append("circle")
    .attr("r", 24)
    .attr("fill", "rgba(123, 63, 160, 0.2)")
    .attr("stroke", COLORS.purple)
    .attr("stroke-width", 1.5);

  nodeGroup
    .append("text")
    .attr("class", "cycle-node-label")
    .attr("text-anchor", "middle")
    .attr("dy", "0.35em")
    .text((d) => (d.label.length > 11 ? `${d.label.slice(0, 11)}...` : d.label));

  container
    .append("p")
    .attr("class", "analysis-note")
    .text("Each arrow means a head-to-head majority preference. This loop means no single candidate beats all others.");
}

function renderGeneralVisualization(container, jurisdiction) {
  const nonAgreement = jurisdiction.elections.filter((election) => election.condorcet !== "green");
  const countsByCategory = CATEGORIES.map((category) => ({
    category,
    count: jurisdiction.elections.filter((election) => election.condorcet === category).length,
  })).filter((d) => d.count > 0);

  container.append("h4").attr("class", "analysis-subtitle").text("Outcome Mix In This Jurisdiction");

  const barChart = container
    .append("svg")
    .attr("class", "outcome-chart")
    .attr("viewBox", "0 0 360 170")
    .attr("preserveAspectRatio", "xMidYMid meet");

  const margin = { top: 10, right: 10, bottom: 26, left: 88 };
  const innerWidth = 360 - margin.left - margin.right;
  const innerHeight = 170 - margin.top - margin.bottom;

  const g = barChart
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  const x = d3
    .scaleLinear()
    .domain([0, d3.max(countsByCategory, (d) => d.count) || 1])
    .range([0, innerWidth]);

  const y = d3
    .scaleBand()
    .domain(countsByCategory.map((d) => LABELS[d.category]))
    .range([0, innerHeight])
    .padding(0.25);

  g.append("g")
    .selectAll("rect")
    .data(countsByCategory)
    .join("rect")
    .attr("x", 0)
    .attr("y", (d) => y(LABELS[d.category]))
    .attr("height", y.bandwidth())
    .attr("width", (d) => x(d.count))
    .attr("fill", (d) => COLORS[d.category])
    .attr("opacity", 0.9);

  g.append("g")
    .selectAll("text.bar-label")
    .data(countsByCategory)
    .join("text")
    .attr("class", "bar-label")
    .attr("x", (d) => x(d.count) + 8)
    .attr("y", (d) => (y(LABELS[d.category]) || 0) + y.bandwidth() / 2)
    .attr("dy", "0.35em")
    .text((d) => d.count);

  g.append("g")
    .selectAll("text.axis-label")
    .data(countsByCategory)
    .join("text")
    .attr("class", "axis-label")
    .attr("x", -10)
    .attr("y", (d) => (y(LABELS[d.category]) || 0) + y.bandwidth() / 2)
    .attr("dy", "0.35em")
    .attr("text-anchor", "end")
    .text((d) => LABELS[d.category]);

  if (nonAgreement.length > 0) {
    const sample = nonAgreement[0];
    container
      .append("p")
      .attr("class", "analysis-note")
      .html(`<strong>${sample.year} ${sample.office}</strong>: ${sample.notes}`);
  }
}

function renderElectionDetail(container, election) {
  container.append("h4").attr("class", "analysis-subtitle").text("Selected Election");
  container
    .append("p")
    .attr("class", "analysis-note")
    .html(`<strong>${election.year} ${election.office}</strong><br>${election.notes}`);
}

function focusCity(point) {
  let targetScale = Math.max(
    currentTransform.k,
    point.isCluster ? CLUSTER_FOCUS_ZOOM : CITY_FOCUS_ZOOM
  );

  if (point.isCluster && point.clusterMaxDistance > 0) {
    const threshold = point.clusterThreshold || CLUSTER_DISTANCE_THRESHOLD;
    const requiredScale = threshold / point.clusterMaxDistance + CLUSTER_BREAK_PADDING;
    targetScale = Math.max(targetScale, requiredScale);
  }

  zoomToPoint(point.x, point.y, targetScale);
}

function openAnalysisPanel(jurisdiction) {
  const content = analysisPanel.select(".analysis-content");

  if (jurisdiction.isCluster && jurisdiction.clusterMemberJurisdictions?.length) {
    renderClusterPicker(content, jurisdiction);
  } else {
    renderElectionList(content, jurisdiction);
  }

  analysisPanel.classed("open", true);
}

function renderClusterPicker(content, cluster) {
  const members = cluster.clusterMemberJurisdictions;
  const citiesHtml = members.map((m) => {
    const color = COLORS[m.elections.reduce((best, e) =>
      PRIORITY[e.condorcet] > PRIORITY[best] ? e.condorcet : best, "green")];
    return `<button type="button" class="cluster-city-btn" data-city-key="${m.key}">
      <span class="cluster-city-dot" style="background:${color}"></span>
      <span class="cluster-city-name">${m.city}</span>
      <span class="cluster-city-count">${m.elections.length} election${m.elections.length === 1 ? "" : "s"}</span>
    </button>`;
  }).join("");

  content.html(`
    <div class="elections-list-view">
      <h3 class="jurisdiction-title">${cluster.city}, ${stateName(cluster.state)}</h3>
      <div class="cluster-city-list">${citiesHtml}</div>
    </div>
  `);

  content.selectAll(".cluster-city-btn").on("click", function () {
    const key = d3.select(this).attr("data-city-key");
    const member = members.find((m) => m.key === key);
    if (member) renderElectionList(content, member, () => renderClusterPicker(content, cluster));
  });
}

function renderElectionList(content, jurisdiction, onBack = null) {
  let sort = { mode: "priority", dir: -1 };

  function render() {
    const backBtn = onBack
      ? `<button type="button" class="cluster-back-btn">← Back</button>`
      : "";
    content.html(`${backBtn}${buildElectionCardsHtml(jurisdiction, sort)}`);

    if (onBack) {
      content.select(".cluster-back-btn").on("click", onBack);
    }
    content.selectAll(".election-card").on("click", function () {
      const idx = parseInt(d3.select(this).attr("data-election-index"), 10);
      openSankeyView(jurisdiction, idx);
    });
    content.selectAll(".election-sort-btn").on("click", function () {
      const clicked = d3.select(this).attr("data-sort");
      sort = { mode: clicked, dir: clicked === sort.mode ? -sort.dir : -1 };
      render();
    });
  }

  render();
}
