// Heavily inspired from work of @davidgilbertson on Github and `leaflet-geoman` project.
import MapboxDraw from '@mapbox/mapbox-gl-draw';

const { geojsonTypes } = MapboxDraw.constants;

import bboxPolygon from '@turf/bbox-polygon';
import booleanDisjoint from '@turf/boolean-disjoint';
import { getCoords } from '@turf/invariant';
import distance from '@turf/distance';
import polygonToLine from '@turf/polygon-to-line';
import nearestPointOnLine from '@turf/nearest-point-on-line';
import nearestPointInPointSet from '@turf/nearest-point';
import midpoint from '@turf/midpoint';
import {
  featureCollection,
  lineString as turfLineString,
  point as turfPoint,
} from '@turf/helpers';

export const IDS = {
  VERTICAL_GUIDE: 'VERTICAL_GUIDE',
  HORIZONTAL_GUIDE: 'HORIZONTAL_GUIDE',
};

export const addPointToVertices = (map, vertices, coordinates) => {
  vertices.push(coordinates);
};

// Remove all viewport calculations and simplify createSnapList
export const createSnapList = (map, draw, currentFeature) => {
  const features = draw.getAll().features;
  const snapList = [];
  const vertices = [];

  const addVerticesToList = (coordinates) => {
    if (!Array.isArray(coordinates)) return;
    
    if (Array.isArray(coordinates[0])) {
      coordinates.forEach(coord => addVerticesToList(coord));
    } else if (coordinates.length === 2) {
      vertices.push(coordinates);
    }
  };

  features.forEach((feature) => {
    // Skip guides and current feature
    if (feature.id === IDS.HORIZONTAL_GUIDE || 
        feature.id === IDS.VERTICAL_GUIDE ||
        feature.id === currentFeature.id) {
      return;
    }

    // Add all vertices
    addVerticesToList(feature.geometry.coordinates);
    
    // Add feature to snap list
    snapList.push(feature);
  });

  console.log('Snap list length:', snapList);
  console.log('Vertices length:', vertices);
  
  return [snapList, vertices];
};

const getNearbyvertices = (vertices, coords) => {
  const verticals = [];
  const horizontals = [];
;

  vertices.forEach((vertex) => {
    verticals.push(vertex[0]);
    horizontals.push(vertex[1]);
  });

  const nearbyVerticalGuide = verticals.find(
    (px) => Math.abs(px - coords.lng) < 0.009
  );

  const nearbyHorizontalGuide = horizontals.find(
    (py) => Math.abs(py - coords.lat) < 0.009
  );

  return {
    verticalPx: nearbyVerticalGuide,
    horizontalPx: nearbyHorizontalGuide,
  };
};

const calcLayerDistances = (lngLat, layer) => {
  console.log('Calculating distances for layer:', layer.id);
  // the point P which we want to snap (probpably the marker that is dragged)
  const P = [lngLat.lng, lngLat.lat];

  // is this a marker?
  const isMarker = layer.geometry.type === 'Point';
  // is it a polygon?
  const isPolygon = layer.geometry.type === 'Polygon';
  // is it a multiPolygon?
  const isMultiPolygon = layer.geometry.type === 'MultiPolygon';
  // is it a multiPoint?
  const isMultiPoint = layer.geometry.type === 'MultiPoint';

  let lines = undefined;

  // the coords of the layer
  const latlngs = getCoords(layer);

  if (isMarker) {
    const [lng, lat] = latlngs;
    // return the info for the marker, no more calculations needed
    return {
      latlng: { lng, lat },
      distance: distance(latlngs, P),
    };
  }

  if (isMultiPoint) {
    const np = nearestPointInPointSet(
      P,
      featureCollection(latlngs.map((x) => turfPoint(x)))
    );
    const c = np.geometry.coordinates;
    return {
      latlng: { lng: c[0], lat: c[1] },
      distance: np.properties.distanceToPoint,
    };
  }

  if (isPolygon || isMultiPolygon) {
    lines = polygonToLine(layer);
  } else {
    lines = layer;
  }

  let nearestPoint;
  if (isPolygon) {
    let lineStrings;
    if (lines.geometry.type === 'LineString') {
      lineStrings = [turfLineString(lines.geometry.coordinates)];
    } else {
      lineStrings = lines.geometry.coordinates.map((coords) =>
        turfLineString(coords)
      );
    }

    const closestFeature = getFeatureWithNearestPoint(lineStrings, P);
    lines = closestFeature.feature;
    nearestPoint = closestFeature.point;
  } else if (isMultiPolygon) {
    const lineStrings = lines.features
      .map((feat) => {
        if (feat.geometry.type === 'LineString') {
          return [feat.geometry.coordinates];
        } else {
          return feat.geometry.coordinates;
        }
      })
      .flatMap((coords) => coords)
      .map((coords) => turfLineString(coords));

    const closestFeature = getFeatureWithNearestPoint(lineStrings, P);
    lines = closestFeature.feature;
    nearestPoint = closestFeature.point;
  } else {
    nearestPoint = nearestPointOnLine(lines, P);
  }

  const [lng, lat] = nearestPoint.geometry.coordinates;

  let segmentIndex = nearestPoint.properties.index;
  let { coordinates } = lines.geometry;

  // Handle MultiLineString properly
  if (lines.geometry.type === "MultiLineString") {
    coordinates = lines.geometry.coordinates[nearestPoint.properties.multiFeatureIndex];
  }

  // Ensure we don't go out of bounds with segment index
  if (segmentIndex + 1 >= coordinates.length) {
    segmentIndex = coordinates.length - 2;
  }

  const results = {
    latlng: { lng, lat },
    segment: coordinates?.slice(segmentIndex, segmentIndex + 2),
    distance: nearestPoint.properties.dist,
    isMarker
  };
  
  console.log('Distance calculation results:', results);
  return results;
};

function getFeatureWithNearestPoint(lineStrings, P) {
  const nearestPointsOfEachFeature = lineStrings.map((feat) => ({
    feature: feat,
    point: nearestPointOnLine(feat, P),
  }));

  nearestPointsOfEachFeature.sort(
    (a, b) => a.point.properties.dist - b.point.properties.dist
  );

  return {
    feature: nearestPointsOfEachFeature[0].feature,
    point: nearestPointsOfEachFeature[0].point,
  };
}

const calcClosestLayer = (lngLat, layers) => {
  let closestLayer = {};

  // loop through the layers
  layers.forEach((layer, index) => {
    // find the closest latlng, segment and the distance of this layer to the dragged marker latlng
    const results = calcLayerDistances(lngLat, layer);

    // save the info if it doesn't exist or if the distance is smaller than the previous one
    if (
      closestLayer.distance === undefined ||
      results.distance < closestLayer.distance
    ) {
      closestLayer = results;
      closestLayer.layer = layer;
    }
  });

  // return the closest layer and it's data
  // if there is no closest layer, return undefined
  return closestLayer;
};

// minimal distance before marker snaps (in pixels)
const metersPerPixel = function (latitude, zoomLevel) {
  const earthCircumference = 40075017;
  const latitudeRadians = latitude * (Math.PI / 180);
  return (
    (earthCircumference * Math.cos(latitudeRadians)) /
    Math.pow(2, zoomLevel + 8)
  );
};

// we got the point we want to snap to (C), but we need to check if a coord of the polygon
function snapToLineOrPolygon(
  closestLayer,
  snapOptions,
  snapVertexPriorityDistance
) {
  // A and B are the points of the closest segment to P (the marker position we want to snap)
  const A = closestLayer.segment[0];
  const B = closestLayer.segment[1];

  // C is the point we would snap to on the segment.
  // The closest point on the closest segment of the closest polygon to P. That's right.
  const C = [closestLayer.latlng.lng, closestLayer.latlng.lat];

  // distances from A to C and B to C to check which one is closer to C
  const distanceAC = distance(A, C);
  const distanceBC = distance(B, C);

  // closest latlng of A and B to C
  let closestVertexLatLng = distanceAC < distanceBC ? A : B;

  // distance between closestVertexLatLng and C
  let shortestDistance = distanceAC < distanceBC ? distanceAC : distanceBC;

  // snap to middle (M) of segment if option is enabled
  if (snapOptions && snapOptions.snapToMidPoints) {
    const M = midpoint(A, B).geometry.coordinates;
    const distanceMC = distance(M, C);

    if (distanceMC < distanceAC && distanceMC < distanceBC) {
      // M is the nearest vertex
      closestVertexLatLng = M;
      shortestDistance = distanceMC;
    }
  }

  // the distance that needs to be undercut to trigger priority
  const priorityDistance = snapVertexPriorityDistance;

  // the latlng we ultemately want to snap to
  let snapLatlng;

  // if C is closer to the closestVertexLatLng (A, B or M) than the snapDistance,
  // the closestVertexLatLng has priority over C as the snapping point.
  if (shortestDistance < priorityDistance) {
    snapLatlng = closestVertexLatLng;
  } else {
    snapLatlng = C;
  }

  // return the copy of snapping point
  const [lng, lat] = snapLatlng;
  return { lng, lat };
}

function snapToPoint(closestLayer) {
  return closestLayer.latlng;
}

const checkPrioritiySnapping = (
  closestLayer,
  snapOptions,
  snapVertexPriorityDistance = 1.25
) => {
  let snappingToPoint = !Array.isArray(closestLayer.segment);
  if (snappingToPoint) {
    return snapToPoint(closestLayer);
  } else {
    return snapToLineOrPolygon(
      closestLayer,
      snapOptions,
      snapVertexPriorityDistance
    );
  }
};

/**
 * Returns snap points if there are any, otherwise the original lng/lat of the event
 * Also, defines if vertices should show on the state object
 *
 * Mutates the state object
 *
 * @param state
 * @param e
 * @returns {{lng: number, lat: number}}
 */
export const snap = (state, e) => {
  let lng = e.lngLat.lng;
  let lat = e.lngLat.lat;
  

  // Holding alt bypasses all snapping
  if (e.originalEvent.altKey) {
    state.showVerticalSnapLine = false;
    state.showHorizontalSnapLine = false;

    return { lng, lat };
  }

  if (state.snapList.length <= 0) {
    return { lng, lat };
  }

  // snapping is on
  let closestLayer, minDistance, snapLatLng;
  if (state.options.snap) {
    console.log('Attempting to snap at:', e.lngLat);
    closestLayer = calcClosestLayer({ lng, lat }, state.snapList);
    console.log('Found closest layer:', closestLayer);

    if (Object.keys(closestLayer).length === 0) {
      console.log('No closest layer found');
      return { lng, lat };
    }

    const isMarker = closestLayer.isMarker;
    const snapVertexPriorityDistance = state.options.snapOptions
      ? state.options.snapOptions.snapVertexPriorityDistance
      : undefined;

    if (!isMarker) {
      snapLatLng = checkPrioritiySnapping(
        closestLayer,
        state.options.snapOptions,
        snapVertexPriorityDistance
      );
      // snapLatLng = closestLayer.latlng;
    } else {
      snapLatLng = closestLayer.latlng;
    }

    // Increase snap distance for better snapping at edges
    minDistance =
      ((state.options.snapOptions && state.options.snapOptions.snapPx) || 50) *
      metersPerPixel(lat, state.map.getZoom());
  }

  let verticalPx, horizontalPx;
  if (state.options.guides) {
    const nearestGuidline = getNearbyvertices(state.vertices, e.lngLat);

    verticalPx = nearestGuidline.verticalPx;
    horizontalPx = nearestGuidline.horizontalPx;

    if (verticalPx) {
      // Draw a line from top to bottom

      const lngLatTop = { lng: verticalPx, lat: e.lngLat.lat + 10 };
      const lngLatBottom = { lng: verticalPx, lat: e.lngLat.lat - 10 };

      state.verticalGuide.updateCoordinate(0, lngLatTop.lng, lngLatTop.lat);
      state.verticalGuide.updateCoordinate(
        1,
        lngLatBottom.lng,
        lngLatBottom.lat
      );
    }

    if (horizontalPx) {
      // Draw a line from left to right

      const lngLatTop = { lng: e.lngLat.lng + 10, lat: horizontalPx };
      const lngLatBottom = { lng: e.lngLat.lng - 10, lat: horizontalPx };

      state.horizontalGuide.updateCoordinate(0, lngLatTop.lng, lngLatTop.lat);
      state.horizontalGuide.updateCoordinate(
        1,
        lngLatBottom.lng,
        lngLatBottom.lat
      );
    }

    state.showVerticalSnapLine = !!verticalPx;
    state.showHorizontalSnapLine = !!horizontalPx;
  }

  if (closestLayer && closestLayer.distance * 1000 < minDistance) {
    return snapLatLng;
  } else if (verticalPx || horizontalPx) {
    if (verticalPx) {
      lng = verticalPx;
    }
    if (horizontalPx) {
      lat = horizontalPx;
    }
    return { lng, lat };
  } else {
    return { lng, lat };
  }
};

export const getGuideFeature = (id) => ({
  id,
  type: geojsonTypes.FEATURE,
  properties: {
    isSnapGuide: 'true', // for styling
  },
  geometry: {
    type: geojsonTypes.LINE_STRING,
    coordinates: [],
  },
});

export const shouldHideGuide = (state, geojson) => {
  if (
    geojson.properties.id === IDS.VERTICAL_GUIDE &&
    (!state.options.guides || !state.showVerticalSnapLine)
  ) {
    return true;
  }

  if (
    geojson.properties.id === IDS.HORIZONTAL_GUIDE &&
    (!state.options.guides || !state.showHorizontalSnapLine)
  ) {
    return true;
  }

  return false;
};
