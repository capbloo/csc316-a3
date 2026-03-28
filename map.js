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
