// --- Color / opacity helpers ---

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

function stateName(abbr) {
  return STATE_NAMES[abbr] || abbr;
}

function formatPersonName(name) {
  return String(name || "")
    .replace(/([A-Za-z])\.([A-Za-z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

// --- Stats & legend ---

function renderStats() {
  const statData = [
    { label: "Ranked Choice Elections", value: allElections.length, colorVar: null },
    { label: "Equivalent to Plurality", value: countFor("green"), colorVar: "var(--green)" },
    { label: "Condorcet Improvement", value: countFor("blue"), colorVar: "var(--blue)" },
    { label: "Condorcet Failure", value: countFor("yellow"), colorVar: "var(--yellow)" },
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

// --- Formatting utilities ---

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

  const localCounts = d3.rollup(jurisdiction.elections, (g) => g.length, (e) => e.condorcet);
  const countsHtml = CATEGORIES
    .filter((cat) => localCounts.get(cat) > 0)
    .map((cat) => `
      <div class="tt-count-row">
        <span class="tt-dot" style="background:${COLORS[cat]}"></span>
        <span class="tt-count-n">${localCounts.get(cat)}</span>
        <span class="tt-count-label">${LABELS[cat]}</span>
      </div>`)
    .join("");

  return `
    <div class="tt-city" style="color:${COLORS[dotColor]}">${jurisdiction.city}</div>
    <div class="tt-state">${stateName(jurisdiction.state)} · ${jurisdiction.elections.length} election${jurisdiction.elections.length > 1 ? "s" : ""}${jurisdiction.isCluster ? ` · ${jurisdiction.clusterMembers.join(", ")}` : ""}</div>
    ${showSourceFlags && sourceCities.length > 0 ? `<div class="source-flags">${sourceCities.map((city) => `<span class="source-flag">${city}</span>`).join("")}</div>` : ""}
    <div class="tt-counts">${countsHtml}</div>
  `;
}

// --- Tooltip ---

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
      <div class="tt-state">${stateName(jurisdiction.state)} · ${LABELS[election.condorcet]}</div>
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

// --- Selection & panel helpers ---

function clearSelections() {
  dotsLayer.selectAll("circle.dot").classed("selected", false);
  detailCityLayer.selectAll("circle.city-dot").classed("selected", false);
  electionLayer.selectAll("circle.election-dot").classed("selected", false);
}

function closeAnalysisPanel() {
  analysisPanel.classed("open", false);
  clearSelections();
}
