const JURISDICTIONS = window.JURISDICTIONS || [];

const STATES_URL = "https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json";
const MAP_WIDTH = 960;
const MAP_HEIGHT = 600;

const CATEGORIES = ["green", "blue", "yellow", "purple"];
const DOT_RADIUS = 12;
const DOT_GLOW_RADIUS = 14;
const SMALL_CITY_DOT_RADIUS = 5.3;
const SMALL_DOT_SAFE_ZONE_PX = 12;
const SMALL_DOT_MAX_OFFSET_PX = 28;
const ZOOM_MIN = 1;
const ZOOM_MAX = 20;
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
  green: "No Change",
  blue: "Condorcet Improvement",
  yellow: "Condorcet Failure",
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
    city: "Utah Valley",
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

const STATE_NAMES = {
  AK: "Alaska", AL: "Alabama", AR: "Arkansas", AZ: "Arizona",
  CA: "California", CO: "Colorado", CT: "Connecticut",
  DC: "Washington D.C.", DE: "Delaware", FL: "Florida",
  GA: "Georgia", HI: "Hawaii", IA: "Iowa", ID: "Idaho",
  IL: "Illinois", IN: "Indiana", KS: "Kansas", KY: "Kentucky",
  LA: "Louisiana", MA: "Massachusetts", MD: "Maryland", ME: "Maine",
  MI: "Michigan", MN: "Minnesota", MO: "Missouri", MS: "Mississippi",
  MT: "Montana", NC: "North Carolina", ND: "North Dakota", NE: "Nebraska",
  NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NV: "Nevada",
  NY: "New York", OH: "Ohio", OK: "Oklahoma", OR: "Oregon",
  PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VA: "Virginia", VI: "U.S. Virgin Islands", VT: "Vermont",
  WA: "Washington", WI: "Wisconsin", WV: "West Virginia", WY: "Wyoming",
};

const activeFilters = new Set(CATEGORIES);
