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
