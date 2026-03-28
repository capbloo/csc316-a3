// DOM selectors
const tooltip = d3.select("#tooltip");
const statsContainer = d3.select("#stats-strip");
const legendContainer = d3.select("#legend-bar");
const mapContainer = d3.select("#map-container");
const sankeyFullscreen = d3.select("#sankey-fullscreen");
const sankeyFsBody = d3.select("#sankey-fs-body");
const sankeyFsTitle = d3.select("#sankey-fs-title");
const sankeyFsCategory = d3.select("#sankey-fs-category");

// Map projection & path
const projection = d3
  .geoAlbersUsa()
  .scale(1200)
  .translate([MAP_WIDTH / 2, MAP_HEIGHT / 2]);

const path = d3.geoPath(projection);

// SVG structure
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

// Zoom controls
const zoomControls = mapContainer
  .append("div")
  .attr("class", "zoom-controls")
  .attr("aria-label", "Map zoom controls");

zoomControls.html(`
  <button type="button" class="zoom-btn" data-zoom="in" aria-label="Zoom in">+</button>
  <button type="button" class="zoom-btn" data-zoom="out" aria-label="Zoom out">-</button>
  <button type="button" class="zoom-btn zoom-reset" data-zoom="reset" aria-label="Reset zoom">Reset</button>
`);

// Analysis panel
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

// Sankey fullscreen close handlers
d3.select("#sankey-fs-close").on("click", () => {
  sankeyFullscreen.attr("hidden", true);
});

d3.select(document).on("keydown.sankey-fullscreen", (event) => {
  if (event.key === "Escape" && !sankeyFullscreen.attr("hidden")) {
    sankeyFullscreen.attr("hidden", true);
  }
});

// Derived data
const allElections = JURISDICTIONS.flatMap((jurisdiction) => jurisdiction.elections);
const counts = d3.rollup(
  allElections,
  (group) => group.length,
  (election) => election.condorcet
);

// Mutable map state
let jurisdictionPoints = [];
let focusedJurisdictionKey = null;
let currentTransform = d3.zoomIdentity;
let detailCityPositions = new Map();
let rawJurisdictionPoints = [];

// Zoom behavior (callbacks defined in clustering.js / map.js — safe since only fired after full load)
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
