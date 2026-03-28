const JURISDICTIONS = window.JURISDICTIONS || [];

const STATES_URL = "https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json";
const MAP_WIDTH = 960;
const MAP_HEIGHT = 600;

const CATEGORIES = ["green", "blue", "yellow", "purple"];
const DOT_RADIUS = 9;
const DOT_GLOW_RADIUS = 11;
const SMALL_CITY_DOT_RADIUS = 5.3;
const SMALL_DOT_SAFE_ZONE_PX = 12;
const SMALL_DOT_MAX_OFFSET_PX = 28;
const ZOOM_MIN = 1;
const ZOOM_MAX = 12;
const CLUSTER_FOCUS_ZOOM = 2.4;
const CITY_FOCUS_ZOOM = CLUSTER_FOCUS_ZOOM * 1.5;
const CLUSTER_BREAK_PADDING = 0.4;

const COLORS = {
  green: "#2d8e4e",
  blue: "#2b6de0",
  yellow: "#d4a017",
  purple: "#7b3fa0",
};

const LABELS = {
  green: "Agreement",
  blue: "IRV Helped",
  yellow: "IRV Condorcet Failure",
  purple: "No Condorcet Winner",
};

const PRIORITY = {
  yellow: 4,
  purple: 3,
  blue: 2,
  green: 1,
};

const CLUSTER_DEFS = [
  {
    id: "ca-bay",
    city: "Bay Area",
    state: "CA",
    distanceThreshold: 42,
    memberKeys: [
      "San Francisco-CA",
      "Oakland-CA",
      "Berkeley-CA",
      "San Leandro-CA",
    ],
  },
  {
    id: "mn-metro",
    city: "Twin Cities",
    state: "MN",
    distanceThreshold: 30,
    memberKeys: [
      "Minneapolis-MN",
      "Bloomington-MN",
      "Minnetonka-MN",
      "St. Louis Park-MN",
    ],
  },
  {
    id: "ut-metro",
    city: "Utah",
    state: "UT",
    distanceThreshold: 36,
    memberKeys: [
      "Elk Ridge-UT",
      "Springville-UT",
      "Vineyard-UT",
      "Woodland Hills-UT",
    ],
  },
];

const CLUSTER_DISTANCE_THRESHOLD = 42;

const activeFilters = new Set(CATEGORIES);

const tooltip = d3.select("#tooltip");
const statsContainer = d3.select("#stats-strip");
const legendContainer = d3.select("#legend-bar");
const mapContainer = d3.select("#map-container");
const sankeyFullscreen = d3.select("#sankey-fullscreen");
const sankeyFsBody = d3.select("#sankey-fs-body");
const sankeyFsTitle = d3.select("#sankey-fs-title");
const sankeyFsCategory = d3.select("#sankey-fs-category");

const projection = d3
  .geoAlbersUsa()
  .scale(1200)
  .translate([MAP_WIDTH / 2, MAP_HEIGHT / 2]);

const path = d3.geoPath(projection);

const svg = mapContainer
  .append("svg")
  .attr("viewBox", `0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`)
  .attr("preserveAspectRatio", "xMidYMid meet");

const zoomScene = svg.append("g").attr("class", "zoom-scene");
const mapLayer = zoomScene.append("g").attr("class", "map-layer");
const borderLayer = zoomScene.append("g").attr("class", "border-layer");
const dotsLayer = zoomScene.append("g").attr("class", "dots-layer");
const detailCityLayer = zoomScene.append("g").attr("class", "detail-city-layer");
const electionLayer = zoomScene.append("g").attr("class", "election-layer");

const zoomControls = mapContainer
  .append("div")
  .attr("class", "zoom-controls")
  .attr("aria-label", "Map zoom controls");

zoomControls.html(`
  <button type="button" class="zoom-btn" data-zoom="in" aria-label="Zoom in">+</button>
  <button type="button" class="zoom-btn" data-zoom="out" aria-label="Zoom out">-</button>
  <button type="button" class="zoom-btn zoom-reset" data-zoom="reset" aria-label="Reset zoom">Reset</button>
`);

const analysisPanel = mapContainer
  .append("aside")
  .attr("class", "analysis-panel")
  .attr("id", "analysis-panel")
  .classed("open", false);

analysisPanel.html(`
  <button type="button" class="analysis-close" aria-label="Close analysis panel">Close</button>
  <div class="analysis-content">
    <h3>Select A City</h3>
    <p>Click any city to focus the map and view its election list.</p>
  </div>
`);

analysisPanel.select(".analysis-close").on("click", () => {
  closeAnalysisPanel();
});

d3.select("#sankey-fs-close").on("click", () => {
  sankeyFullscreen.attr("hidden", true);
});

d3.select(document).on("keydown.sankey-fullscreen", (event) => {
  if (event.key === "Escape" && !sankeyFullscreen.attr("hidden")) {
    sankeyFullscreen.attr("hidden", true);
  }
});

const allElections = JURISDICTIONS.flatMap((jurisdiction) => jurisdiction.elections);
const counts = d3.rollup(
  allElections,
  (group) => group.length,
  (election) => election.condorcet
);

let jurisdictionPoints = [];
let focusedJurisdictionKey = null;
let currentTransform = d3.zoomIdentity;
let detailCityPositions = new Map();
let rawJurisdictionPoints = [];

const zoomBehavior = d3
  .zoom()
  .scaleExtent([ZOOM_MIN, ZOOM_MAX])
  .on("zoom", (event) => {
    currentTransform = event.transform;
    maybeReclusterForZoom();
    zoomScene.attr("transform", currentTransform);
    applyJurisdictionDotScale();
    updateCityDotMode();
    updateExpandedElections();
  });

function scaleForZoom(value) {
  return value / currentTransform.k;
}

function isDetailZoom() {
  return false;
}

function getBaseDotStrokeWidth() {
  return 0;
}

function getDotLabelFontSize(electionCount) {
  return electionCount >= 100 ? 8 : 10;
}

function applyJurisdictionDotScale() {
  dotsLayer
    .selectAll("circle.dot-glow")
    .attr("r", scaleForZoom(DOT_GLOW_RADIUS));

  dotsLayer
    .selectAll("circle.dot")
    .attr("r", scaleForZoom(DOT_RADIUS))
    .attr("stroke-width", 0);

  dotsLayer
    .selectAll("text.dot-label")
    .attr("font-size", (d) => scaleForZoom(getDotLabelFontSize(getVisibleElectionCount(d))));

  detailCityLayer
    .selectAll("circle.city-dot")
    .attr("r", scaleForZoom(SMALL_CITY_DOT_RADIUS))
    .attr("stroke-width", 0);

  detailCityLayer
    .selectAll("text.city-name-label")
    .attr("x", (d) => getDetailCityPosition(d).x + scaleForZoom(7))
    .attr("y", (d) => getDetailCityPosition(d).y - scaleForZoom(2))
    .attr("font-size", scaleForZoom(10));
}

function getDetailCityPosition(point) {
  return detailCityPositions.get(point.key) || { x: point.x, y: point.y };
}

function updateDetailCityPositions() {
  const visiblePoints = jurisdictionPoints.filter((point) => activeFilters.has(point.category));
  const nodes = visiblePoints.map((point, index) => ({
    key: point.key,
    ox: point.x,
    oy: point.y,
    x: point.x,
    y: point.y,
    seed: index + 1,
  }));

  const minDist = SMALL_DOT_SAFE_ZONE_PX / currentTransform.k;
  const maxOffset = SMALL_DOT_MAX_OFFSET_PX / currentTransform.k;

  for (let iter = 0; iter < 28; iter += 1) {
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = nodes[i];
        const b = nodes[j];

        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let dist = Math.hypot(dx, dy);

        if (dist === 0) {
          const angle = ((a.seed * 9301 + b.seed * 49297) % 360) * (Math.PI / 180);
          dx = Math.cos(angle) * 0.0001;
          dy = Math.sin(angle) * 0.0001;
          dist = Math.hypot(dx, dy);
        }

        if (dist < minDist) {
          const push = (minDist - dist) * 0.5;
          const ux = dx / dist;
          const uy = dy / dist;
          a.x -= ux * push;
          a.y -= uy * push;
          b.x += ux * push;
          b.y += uy * push;
        }
      }
    }

    nodes.forEach((node) => {
      node.x += (node.ox - node.x) * 0.12;
      node.y += (node.oy - node.y) * 0.12;

      const offsetX = node.x - node.ox;
      const offsetY = node.y - node.oy;
      const offsetDist = Math.hypot(offsetX, offsetY);

      if (offsetDist > maxOffset) {
        const scale = maxOffset / offsetDist;
        node.x = node.ox + offsetX * scale;
        node.y = node.oy + offsetY * scale;
      }
    });
  }

  detailCityPositions = new Map(nodes.map((node) => [node.key, { x: node.x, y: node.y }]));
}

function countFor(category) {
  return counts.get(category) || 0;
}

function getJurisdictionColor(elections) {
  return elections.reduce((best, election) => {
    return PRIORITY[election.condorcet] > PRIORITY[best] ? election.condorcet : best;
  }, "green");
}

function getVisibleElectionCount(jurisdiction) {
  return jurisdiction.elections.filter((election) => activeFilters.has(election.condorcet)).length;
}

function getVisibleJurisdictionColor(jurisdiction) {
  const visibleElections = jurisdiction.elections.filter((election) => activeFilters.has(election.condorcet));
  if (!visibleElections.length) {
    return jurisdiction.category;
  }
  return getJurisdictionColor(visibleElections);
}

function getDotOpacity(jurisdiction) {
  return getVisibleElectionCount(jurisdiction) > 0 ? 0.85 : 0.04;
}

function getGlowOpacity(jurisdiction) {
  return getVisibleElectionCount(jurisdiction) > 0 ? 0.08 : 0;
}

function getLabelOpacity(jurisdiction) {
  return getVisibleElectionCount(jurisdiction) > 0 ? 1 : 0.04;
}

function getJurisdictionKey(jurisdiction) {
  return `${jurisdiction.city}-${jurisdiction.state}`;
}

function pointsSignature(points) {
  return points.map((point) => point.key).sort().join("|");
}

function isClusterSignificant(memberPoints, zoomK = 1, distanceThreshold = CLUSTER_DISTANCE_THRESHOLD) {
  if (memberPoints.length < 2) {
    return false;
  }

  let maxDistance = 0;
  for (let i = 0; i < memberPoints.length; i += 1) {
    for (let j = i + 1; j < memberPoints.length; j += 1) {
      const dx = memberPoints[i].x - memberPoints[j].x;
      const dy = memberPoints[i].y - memberPoints[j].y;
      maxDistance = Math.max(maxDistance, Math.hypot(dx, dy));
    }
  }

  return maxDistance <= distanceThreshold / zoomK;
}

function applyCityClusters(points, zoomK = 1) {
  const byKey = new Map(points.map((point) => [point.key, point]));
  const consumed = new Set();
  const clustered = [];

  CLUSTER_DEFS.forEach((clusterDef) => {
    const members = clusterDef.memberKeys
      .map((key) => byKey.get(key))
      .filter(Boolean)
      .filter((point) => !consumed.has(point.key));

    const distanceThreshold = clusterDef.distanceThreshold || CLUSTER_DISTANCE_THRESHOLD;

    if (!isClusterSignificant(members, zoomK, distanceThreshold)) {
      return;
    }

    members.forEach((member) => consumed.add(member.key));

    const totalWeight = members.reduce((sum, member) => sum + Math.max(member.elections.length, 1), 0);
    const x = members.reduce((sum, member) => sum + member.x * Math.max(member.elections.length, 1), 0) / totalWeight;
    const y = members.reduce((sum, member) => sum + member.y * Math.max(member.elections.length, 1), 0) / totalWeight;
    const mergedElections = members.flatMap((member) =>
      member.elections.map((election) => ({
        ...election,
        sourceCity: member.city,
      }))
    );

    let clusterMaxDistance = 0;
    for (let i = 0; i < members.length; i += 1) {
      for (let j = i + 1; j < members.length; j += 1) {
        clusterMaxDistance = Math.max(
          clusterMaxDistance,
          Math.hypot(members[i].x - members[j].x, members[i].y - members[j].y)
        );
      }
    }

    clustered.push({
      city: clusterDef.city,
      state: clusterDef.state,
      key: `cluster-${clusterDef.id}`,
      x,
      y,
      elections: mergedElections,
      category: getJurisdictionColor(mergedElections),
      radius: DOT_RADIUS,
      clickable: true,
      isCluster: true,
      clusterMembers: members.map((member) => member.city),
      clusterMaxDistance,
      clusterThreshold: distanceThreshold,
    });
  });

  points.forEach((point) => {
    if (!consumed.has(point.key)) {
      clustered.push(point);
    }
  });

  return clustered;
}

function maybeReclusterForZoom() {
  const nextPoints = buildJurisdictionPoints(currentTransform.k).sort((a, b) => getZOrder(a) - getZOrder(b));
  if (pointsSignature(nextPoints) !== pointsSignature(jurisdictionPoints)) {
    jurisdictionPoints = nextPoints;
    renderDots();
  }
}

function getZOrder(point) {
  return PRIORITY[point.category] || 0;
}

function isStackedJurisdiction(point) {
  const nonAgreement = point.elections.filter((election) => election.condorcet !== "green");
  return nonAgreement.length > 1;
}

function buildRawJurisdictionPoints() {
  return JURISDICTIONS.map((jurisdiction) => {
    const projected = projection([jurisdiction.lng, jurisdiction.lat]);
    if (!projected) {
      return null;
    }

    const category = getJurisdictionColor(jurisdiction.elections);
    return {
      ...jurisdiction,
      key: getJurisdictionKey(jurisdiction),
      x: projected[0],
      y: projected[1],
      category,
      radius: DOT_RADIUS,
      clickable: true,
    };
  }).filter(Boolean);
}

function buildJurisdictionPoints(zoomK = currentTransform.k) {
  return applyCityClusters(rawJurisdictionPoints, zoomK);
}

function renderStats() {
  const statData = [
    { label: "Ranked Choice Elections", value: allElections.length, colorVar: null },
    { label: "Equivalent to Plurality", value: countFor("green"), colorVar: "var(--green)" },
    { label: "Instant Runoff Helped", value: countFor("blue"), colorVar: "var(--blue)" },
    { label: "Instant Runoff Condorcet Failure", value: countFor("yellow"), colorVar: "var(--yellow)" },
    { label: "No Condorcet Winner", value: countFor("purple"), colorVar: "var(--purple)" },
  ];

  const statItems = statsContainer
    .selectAll(".stat-item")
    .data(statData, (d) => d.label)
    .join((enter) => {
      const item = enter.append("div").attr("class", "stat-item");
      item.append("div").attr("class", "stat-num");
      item.append("div").attr("class", "stat-label");
      return item;
    });

  statItems
    .select(".stat-num")
    .style("color", (d) => d.colorVar || null)
    .text((d) => d.value);

  statItems.select(".stat-label").text((d) => d.label);
}

function renderLegend() {
  const legendButtons = legendContainer
    .selectAll("button.legend-btn")
    .data(CATEGORIES, (d) => d)
    .join("button")
    .attr("type", "button")
    .attr("class", "legend-btn")
    .style("color", (category) => COLORS[category])
    .on("click", function onLegendClick(_event, category) {
      if (activeFilters.has(category)) {
        activeFilters.delete(category);
      } else {
        activeFilters.add(category);
      }

      updateLegendState();
      updateDotVisibility();
      updateExpandedElections();
    });

  legendButtons.html(
    (category) =>
      `<span class="legend-dot" style="background:${COLORS[category]}"></span>${LABELS[category]}<span class="legend-count">${countFor(category)}</span>`
  );

  updateLegendState();
}

function updateLegendState() {
  legendContainer
    .selectAll("button.legend-btn")
    .classed("active", (category) => activeFilters.has(category));
}

function formatOfficeLabel(office) {
  const text = String(office || "");
  return text
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .replace(/(\d)([A-Za-z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

function getOrderedElections(jurisdiction) {
  return [...jurisdiction.elections].sort((a, b) => {
    const byPriority = PRIORITY[b.condorcet] - PRIORITY[a.condorcet];
    if (byPriority !== 0) {
      return byPriority;
    }

    const byYear = (b.year || 0) - (a.year || 0);
    if (byYear !== 0) {
      return byYear;
    }

    return (a.office || "").localeCompare(b.office || "");
  });
}

function getSourceCities(jurisdiction) {
  return Array.from(
    new Set(
      jurisdiction.elections
        .map((election) => election.sourceCity)
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b));
}

function buildElectionListHtml(elections, maxItems = null) {
  const shown = maxItems == null ? elections : elections.slice(0, maxItems);
  let html = shown
    .map(
      (election) => `
      <div class="tt-election-item">
        <span class="tt-dot" style="background:${COLORS[election.condorcet]}"></span>
        <div class="tt-election-text"><strong>${election.year} ${formatOfficeLabel(election.office)}</strong><br>${election.notes}</div>
      </div>
    `
    )
    .join("");

  if (maxItems != null && elections.length > maxItems) {
    html += `<div style="color:var(--text-dim);font-style:italic;padding:4px 0;">+ ${elections.length - maxItems} more elections</div>`;
  }

  return html;
}

function buildJurisdictionViewHtml(jurisdiction) {
  const dotColor = getJurisdictionColor(jurisdiction.elections);
  const sourceCities = getSourceCities(jurisdiction);
  const showSourceFlags = currentTransform.k < CITY_FOCUS_ZOOM;

  const counts = d3.rollup(jurisdiction.elections, (g) => g.length, (e) => e.condorcet);
  const countsHtml = CATEGORIES
    .filter((cat) => counts.get(cat) > 0)
    .map((cat) => `
      <div class="tt-count-row">
        <span class="tt-dot" style="background:${COLORS[cat]}"></span>
        <span class="tt-count-n">${counts.get(cat)}</span>
        <span class="tt-count-label">${LABELS[cat]}</span>
      </div>`)
    .join("");

  return `
    <div class="tt-city" style="color:${COLORS[dotColor]}">${jurisdiction.city}</div>
    <div class="tt-state">${jurisdiction.state} · ${jurisdiction.elections.length} election${jurisdiction.elections.length > 1 ? "s" : ""}${jurisdiction.isCluster ? ` · ${jurisdiction.clusterMembers.join(", ")}` : ""}</div>
    ${showSourceFlags && sourceCities.length > 0 ? `<div class="source-flags">${sourceCities.map((city) => `<span class="source-flag">${city}</span>`).join("")}</div>` : ""}
    <div class="tt-counts">${countsHtml}</div>
  `;
}

function showTooltip(event, jurisdiction) {
  tooltip
    .html(buildJurisdictionViewHtml(jurisdiction))
    .style("opacity", 1);

  positionTooltip(event);
}

function showElectionTooltip(event, jurisdiction, election) {
  tooltip
    .html(`
      <div class="tt-city" style="color:${COLORS[election.condorcet]}">${jurisdiction.city}</div>
      <div class="tt-state">${jurisdiction.state} · ${LABELS[election.condorcet]}</div>
      <div class="tt-elections">
        <div class="tt-election-item">
          <span class="tt-dot" style="background:${COLORS[election.condorcet]}"></span>
          <div class="tt-election-text"><strong>${election.year} ${election.office}</strong><br>${election.notes}</div>
        </div>
      </div>
    `)
    .style("opacity", 1);

  positionTooltip(event);
}

function hideTooltip() {
  tooltip.style("opacity", 0);
}

function clearSelections() {
  dotsLayer.selectAll("circle.dot").classed("selected", false);
  detailCityLayer.selectAll("circle.city-dot").classed("selected", false);
  electionLayer.selectAll("circle.election-dot").classed("selected", false);
}

function closeAnalysisPanel() {
  analysisPanel.classed("open", false);
  clearSelections();
}

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

function openAnalysisPanel(jurisdiction) {
  const content = analysisPanel.select(".analysis-content");
  content.html(buildElectionCardsHtml(jurisdiction));

  // Add click handlers to cards
  content.selectAll(".election-card").on("click", function () {
    const idx = parseInt(d3.select(this).attr("data-election-index"), 10);
    openSankeyView(jurisdiction, idx);
  });

  analysisPanel.classed("open", true);
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

function positionTooltip(event) {
  const node = tooltip.node();
  if (!node) {
    return;
  }

  const width = node.offsetWidth;
  const height = node.offsetHeight;

  let x = event.clientX + 16;
  let y = event.clientY - 20;

  if (x + width > window.innerWidth - 20) {
    x = event.clientX - width - 16;
  }

  if (y + height > window.innerHeight - 20) {
    y = window.innerHeight - height - 20;
  }

  if (y < 10) {
    y = 10;
  }

  tooltip.style("left", `${x}px`).style("top", `${y}px`);
}

function renderMap(statesTopoJson) {
  const states = topojson.feature(statesTopoJson, statesTopoJson.objects.states).features;
  const borders = topojson.mesh(statesTopoJson, statesTopoJson.objects.states, (a, b) => a !== b);

  mapLayer
    .selectAll("path.state")
    .data(states)
    .join("path")
    .attr("class", "state")
    .attr("d", path)
    .attr("fill", "#1a1f27")
    .attr("stroke", "#2a2e35")
    .attr("stroke-width", 0.5);

  borderLayer
    .selectAll("path.state-border")
    .data([borders])
    .join("path")
    .attr("class", "state-border")
    .attr("d", path)
    .attr("fill", "none")
    .attr("stroke", "#2a2e35")
    .attr("stroke-width", 0.5);
}

function zoomToPoint(x, y, scale) {
  const clampedScale = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, scale));
  const tx = MAP_WIDTH * 0.25 - x * clampedScale;
  const ty = MAP_HEIGHT / 2 - y * clampedScale;
  const transform = d3.zoomIdentity.translate(tx, ty).scale(clampedScale);

  svg
    .transition()
    .duration(500)
    .call(zoomBehavior.transform, transform);
}

function getFocusedJurisdiction() {
  if (!focusedJurisdictionKey) {
    return null;
  }

  return jurisdictionPoints.find((point) => point.key === focusedJurisdictionKey) || null;
}

function getExpandedElectionPoints(jurisdiction) {
  const nonAgreementElections = jurisdiction.elections.filter(
    (election) => election.condorcet !== "green" && activeFilters.has(election.condorcet)
  );

  const count = nonAgreementElections.length;
  if (count <= 1) {
    return [];
  }

  const spreadPx = 18;
  const mapSpread = spreadPx / currentTransform.k;

  return nonAgreementElections.map((election, index) => {
    const angle = (Math.PI * 2 * index) / count - Math.PI / 2;
    const orbit = mapSpread * (1 + Math.floor(index / 8) * 0.7);
    const dx = Math.cos(angle) * orbit;
    const dy = Math.sin(angle) * orbit;

    return {
      election,
      jurisdiction,
      key: `${jurisdiction.key}-${index}-${election.year}-${election.office}`,
      x: jurisdiction.x + dx,
      y: jurisdiction.y + dy,
    };
  });
}

function updateExpandedElections() {
  electionLayer.selectAll("circle.election-dot").remove();
}

function renderDots() {
  if (!jurisdictionPoints.length) {
    jurisdictionPoints = buildJurisdictionPoints().sort((a, b) => getZOrder(a) - getZOrder(b));
  }
  updateDetailCityPositions();

  const jurisdictionGroups = dotsLayer
    .selectAll("g.jurisdiction")
    .data(jurisdictionPoints, (d) => d.key)
    .join((enter) => {
      const group = enter.append("g").attr("class", "jurisdiction");

      group.append("circle").attr("class", "dot-glow");
      group.append("circle").attr("class", "dot");
      group
        .append("text")
        .attr("class", "dot-label")
        .attr("text-anchor", "middle")
        .attr("dy", "0.35em")
        .attr("font-family", "'JetBrains Mono', monospace")
        .attr("font-size", 10)
        .attr("font-weight", 500)
        .attr("fill", "white")
        .style("pointer-events", "none");

      return group;
    });

  jurisdictionGroups.sort((a, b) => getZOrder(a) - getZOrder(b));

  jurisdictionGroups
    .select("circle.dot-glow")
    .attr("class", (d) => `dot-glow dot-${getVisibleJurisdictionColor(d)}`)
    .attr("cx", (d) => d.x)
    .attr("cy", (d) => d.y)
    .attr("r", scaleForZoom(DOT_GLOW_RADIUS))
    .attr("fill", (d) => COLORS[getVisibleJurisdictionColor(d)])
    .attr("opacity", (d) => getGlowOpacity(d));

  jurisdictionGroups
    .select("circle.dot")
    .attr("class", (d) => `dot dot-${getVisibleJurisdictionColor(d)}`)
    .attr("cx", (d) => d.x)
    .attr("cy", (d) => d.y)
    .attr("r", scaleForZoom(DOT_RADIUS))
    .attr("fill", (d) => COLORS[getVisibleJurisdictionColor(d)])
    .attr("opacity", (d) => getDotOpacity(d))
    .attr("stroke", "none")
    .attr("stroke-width", 0)
    .attr("cursor", (d) => (d.clickable ? "pointer" : "default"))
    .on("mouseenter", function onMouseEnter(event, d) {
      d3.select(this).attr("opacity", 1);
      showTooltip(event, d);
    })
    .on("mousemove", function onMouseMove(event) {
      positionTooltip(event);
    })
    .on("mouseleave", function onMouseLeave(_event, d) {
      d3.select(this).attr("opacity", getDotOpacity(d));
      hideTooltip();
    })
    .on("click", function onCityClick(event, d) {
      event.stopPropagation();

      clearSelections();
      d3.select(this).classed("selected", true);
      focusedJurisdictionKey = d.key;
      focusCity(d);
      updateExpandedElections();
      openAnalysisPanel(d);
    });

  jurisdictionGroups
    .select("text.dot-label")
    .attr("class", (d) => `dot-label dot-${getVisibleJurisdictionColor(d)}`)
    .attr("x", (d) => d.x)
    .attr("y", (d) => d.y)
    .attr("font-size", (d) => scaleForZoom(getDotLabelFontSize(getVisibleElectionCount(d))))
    .attr("opacity", (d) => getLabelOpacity(d))
    .text((d) => getVisibleElectionCount(d));

  const detailGroups = detailCityLayer
    .selectAll("g.detail-city")
    .data(jurisdictionPoints, (d) => d.key)
    .join((enter) => {
      const group = enter.append("g").attr("class", "detail-city");
      group.append("circle").attr("class", "city-dot");
      group.append("text").attr("class", "city-name-label");
      return group;
    });

  detailGroups.sort((a, b) => getZOrder(a) - getZOrder(b));

  detailGroups
    .select("circle.city-dot")
    .attr("cx", (d) => getDetailCityPosition(d).x)
    .attr("cy", (d) => getDetailCityPosition(d).y)
    .attr("r", scaleForZoom(SMALL_CITY_DOT_RADIUS))
    .attr("fill", (d) => COLORS[getVisibleJurisdictionColor(d)])
    .attr("stroke", "none")
    .attr("stroke-width", 0)
    .attr("cursor", (d) => (d.clickable ? "pointer" : "default"))
    .on("mouseenter", function onMouseEnter(event, d) {
      d3.select(this).attr("opacity", 1);
      showTooltip(event, d);
    })
    .on("mousemove", function onMouseMove(event) {
      positionTooltip(event);
    })
    .on("mouseleave", function onMouseLeave(_event, d) {
      d3.select(this).attr("opacity", getDotOpacity(d));
      hideTooltip();
    })
    .on("click", function onCityClick(event, d) {
      event.stopPropagation();

      clearSelections();
      d3.select(this).classed("selected", true);
      focusedJurisdictionKey = d.key;
      focusCity(d);
      updateExpandedElections();
      openAnalysisPanel(d);
    });

  detailGroups
    .select("text.city-name-label")
    .attr("x", (d) => getDetailCityPosition(d).x + scaleForZoom(7))
    .attr("y", (d) => getDetailCityPosition(d).y - scaleForZoom(2))
    .attr("font-size", scaleForZoom(10))
    .text((d) => d.city);

  updateCityDotMode();
}

function updateCityDotMode() {
  const detailMode = false;

  dotsLayer
    .selectAll("circle.dot")
    .attr("opacity", (d) => (detailMode ? 0 : getDotOpacity(d)))
    .style("pointer-events", detailMode ? "none" : "auto");

  dotsLayer
    .selectAll("circle.dot-glow")
    .attr("opacity", (d) => (detailMode ? 0 : getGlowOpacity(d)));

  dotsLayer
    .selectAll("text.dot-label")
    .attr("opacity", (d) => (detailMode ? 0 : getLabelOpacity(d)));

  detailCityLayer
    .selectAll("circle.city-dot")
    .attr("opacity", 0)
    .style("pointer-events", "none");

  detailCityLayer
    .selectAll("text.city-name-label")
    .attr("opacity", (d) => (getVisibleElectionCount(d) > 0 ? 0.95 : 0));
}

function updateDotVisibility() {
  updateDetailCityPositions();

  dotsLayer
    .selectAll("circle.dot-glow")
    .attr("class", (d) => `dot-glow dot-${getVisibleJurisdictionColor(d)}`)
    .attr("fill", (d) => COLORS[getVisibleJurisdictionColor(d)]);

  dotsLayer
    .selectAll("circle.dot")
    .attr("class", (d) => `dot dot-${getVisibleJurisdictionColor(d)}`)
    .attr("fill", (d) => COLORS[getVisibleJurisdictionColor(d)]);

  dotsLayer
    .selectAll("text.dot-label")
    .attr("class", (d) => `dot-label dot-${getVisibleJurisdictionColor(d)}`)
    .attr("font-size", (d) => scaleForZoom(getDotLabelFontSize(getVisibleElectionCount(d))))
    .text((d) => getVisibleElectionCount(d));

  detailCityLayer
    .selectAll("circle.city-dot")
    .attr("fill", (d) => COLORS[getVisibleJurisdictionColor(d)])
    .attr("cx", (d) => getDetailCityPosition(d).x)
    .attr("cy", (d) => getDetailCityPosition(d).y);

  detailCityLayer
    .selectAll("text.city-name-label")
    .attr("x", (d) => getDetailCityPosition(d).x + scaleForZoom(7))
    .attr("y", (d) => getDetailCityPosition(d).y - scaleForZoom(2));

  updateCityDotMode();
}

function setupZoomControls() {
  zoomControls.selectAll(".zoom-btn").on("click", function onZoomClick(event) {
    event.stopPropagation();
    const action = d3.select(this).attr("data-zoom");

    if (action === "in") {
      svg.transition().duration(200).call(zoomBehavior.scaleBy, 1.35);
      return;
    }

    if (action === "out") {
      svg.transition().duration(200).call(zoomBehavior.scaleBy, 0.74);
      return;
    }

    svg.transition().duration(300).call(zoomBehavior.transform, d3.zoomIdentity);
    focusedJurisdictionKey = null;
    updateExpandedElections();
  });
}

function renderSankeyDiagram(container, election, jurisdiction) {
  if (!election.sankey) {
    container.append("p").text("No Sankey data available for this election.");
    return;
  }
  try {
    if (election.sankey.links.length === 0) {
      renderDonutChart(container, election);
    } else {
      renderSankeyWithLibrary(container, election);
    }
  } catch (error) {
    console.error("Error rendering diagram:", error);
    container.append("p").attr("style", "color: red; font-size: 12px;").text(`Diagram error: ${error.message}`);
  }
}

function renderSankeyWithLibrary(container, election) {
  const { nodes: rawNodes, links: rawLinks, rounds } = election.sankey;
  if (!rawNodes || rawNodes.length === 0) return;

  const winnerName = rounds.find((r) => r.winner)?.winner;
  const stageKeys = [...new Set(rawNodes.map((n) => n.stage))].sort((a, b) => a - b);
  const numStages = stageKeys[stageKeys.length - 1];

  // Rank candidates by first-round vote count (descending); Exhausted always last
  const round1Tallies = rounds.find((r) => r.stage === 1)?.tallies || {};
  const candidateRank = Object.fromEntries(
    Object.entries(round1Tallies)
      .sort(([, a], [, b]) => b - a)
      .map(([name], i) => [name, i])
  );
  const getRank = (name) => (name === "Exhausted" ? 9999 : (candidateRank[name] ?? 9998));

  // Candidate color palette
  const candidateNames = [...new Set(rawNodes.map((n) => n.name).filter((n) => n !== "Exhausted"))];
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

  // Layout dimensions — fill the map container overlay
  const mapEl = document.getElementById("map-container");
  const totalSvgWidth = mapEl.clientWidth || 960;
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
  const sankeyInputNodes = rawNodes.map((n, i) => {
    nodeIndexMap[n.id] = i;
    return { id: n.id, name: n.name, stage: n.stage };
  });

  const sankeyInputLinks = rawLinks.map((l) => ({
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
    .text((stage) => stage === numStages ? "FINAL" : `ROUND ${stage}`);

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
    .on("mouseenter", function () { d3.select(this).attr("stroke-opacity", 0.65); })
    .on("mouseleave", function () { d3.select(this).attr("stroke-opacity", 0.32); })
    .append("title")
    .text((d) => `${d.source.name} → ${d.target.name}: ${d3.format(",d")(d.rawValue)} votes`);

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
    .append("title")
    .text((d) => {
      const roundData = rounds.find((r) => r.stage === d.stage);
      const votes = roundData?.tallies?.[d.name];
      return votes != null ? `${d.name}: ${d3.format(",d")(votes)} votes` : d.name;
    });

  // Node labels: first stage on left, last stage on right
  const labelLayer = g.append("g").attr("font-family", "var(--font-sans, sans-serif)");

  visibleNodes.forEach((d) => {
    const isFirst = d.stage === stageKeys[0];
    const isLast = d.stage === numStages;
    const isExhausted = d.name === "Exhausted";
    if (!isFirst && !isLast && !isExhausted) return;

    const midY = (d.y0 + d.y1) / 2;
    const isWinner = d.name === winnerName && isLast;
    const maxChars = 30;
    const label = d.name.length > maxChars ? d.name.substring(0, maxChars - 1) + "…" : d.name;

    // Candidate name — first stage on left, last stage on right
    // Exhausted in intermediate stages gets no name (count alone is enough)
    if (isFirst || isLast) {
      labelLayer
        .append("text")
        .attr("x", isFirst ? d.x0 - 10 : d.x1 + 10)
        .attr("y", midY - (isLast ? 8 : 0))
        .attr("text-anchor", isFirst ? "end" : "start")
        .attr("dominant-baseline", "middle")
        .attr("font-size", "13px")
        .attr("fill", isWinner ? "#4ade80" : "var(--text)")
        .attr("font-weight", isWinner ? "700" : "400")
        .text(isWinner ? `★ ${label}` : label);
    }

    // Vote count: last-stage nodes (below name) + Exhausted in every stage
    if (isLast || isExhausted) {
      const roundData = rounds.find((r) => r.stage === d.stage);
      const votes = roundData?.tallies?.[d.name];
      if (votes != null) {
        labelLayer
          .append("text")
          .attr("x", d.x1 + 10)
          .attr("y", isLast ? midY + 10 : midY)
          .attr("text-anchor", "start")
          .attr("dominant-baseline", "middle")
          .attr("font-size", "11px")
          .attr("fill", "var(--text-dim)")
          .text(d3.format(",d")(votes));
      }
    }
  });
}

function renderDonutChart(container, election) {
  const { nodes: rawNodes, rounds } = election.sankey;
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
  const totalSvgWidth = mapEl.clientWidth || 960;
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
  const midpointArc = d3.arc().innerRadius(outerRadius).outerRadius(outerRadius);

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

function buildElectionCardsHtml(jurisdiction) {
  const elections = jurisdiction.elections;
  // Non-green (interesting) results float to the top; relative order preserved within each group
  const sorted = elections
    .map((election, idx) => ({ election, idx }))
    .sort((a, b) => {
      const aGreen = a.election.condorcet === "green" ? 1 : 0;
      const bGreen = b.election.condorcet === "green" ? 1 : 0;
      return aGreen - bGreen || a.idx - b.idx;
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
      <div class="election-card-preview">${election.notes.substring(0, 80)}...</div>
    </div>
  `
    )
    .join("");

  return `
    <div class="elections-list-view">
      <h3 class="jurisdiction-title">${jurisdiction.city}, ${jurisdiction.state}</h3>
      <div class="elections-grid">
        ${cardsHtml}
      </div>
    </div>
  `;
}

function openSankeyView(jurisdiction, electionIndex) {
  const election = jurisdiction.elections[electionIndex];

  sankeyFsTitle.text(`${election.year} ${formatOfficeLabel(election.office)} · ${jurisdiction.city}, ${jurisdiction.state}`);
  sankeyFsCategory.text(LABELS[election.condorcet]).style("color", COLORS[election.condorcet]);

  sankeyFsBody.html("");

  const diagramWrap = sankeyFsBody.append("div").attr("class", "sankey-fs-diagram-wrap");
  renderSankeyDiagram(diagramWrap, election, jurisdiction);

  if (election.condorcet === "purple") {
    const pairwiseWrap = sankeyFsBody.append("div").attr("class", "sankey-fs-pairwise-wrap");
    renderPairwiseComparison(pairwiseWrap, election);
  }

  sankeyFullscreen.attr("hidden", null);
}

async function init() {
  renderStats();
  renderLegend();

  const statesTopoJson = await d3.json(STATES_URL);
  renderMap(statesTopoJson);
  rawJurisdictionPoints = buildRawJurisdictionPoints();
  jurisdictionPoints = buildJurisdictionPoints().sort((a, b) => getZOrder(a) - getZOrder(b));
  renderDots();

  svg.call(zoomBehavior).on("dblclick.zoom", null);
  setupZoomControls();

  svg.on("click", () => {
    closeAnalysisPanel();
  });
}

init().catch((error) => {
  console.error("Failed to initialize map:", error);
});
