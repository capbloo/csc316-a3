// --- Zoom-scale helpers ---

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

// --- Clustering ---

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
