/**
 * Maps CRS (Congressional Research Service) policy areas to user-friendly
 * topic labels for the bills listing page.
 */

export interface TopicInfo {
  label: string;
  /** CRS policyArea values that map to this topic */
  policyAreas: string[];
  /**
   * Roll Call line-palette background class (`bg-line-*`), or null.
   *
   * Line colour is identification, never scanning: it renders ONLY as a
   * 5–6px rule or left-margin bar — never a chip fill, never type
   * (four of the eleven hues fail AA as text on sand). Eleven hues is
   * the ceiling of the ramp (guide §5.3), so topics beyond the brand's
   * eleven carry no line colour and are set typographically.
   */
  line: string | null;
}

export const TOPICS: TopicInfo[] = [
  {
    label: "Health",
    policyAreas: ["Health"],
    line: "bg-line-health",
  },
  {
    label: "Defense",
    policyAreas: ["Armed Forces and National Security"],
    line: "bg-line-defense",
  },
  {
    label: "Education",
    policyAreas: ["Education"],
    line: "bg-line-education",
  },
  {
    label: "Economy",
    policyAreas: [
      "Economics and Public Finance",
      "Finance and Financial Sector",
    ],
    line: "bg-line-economy",
  },
  {
    label: "Environment",
    policyAreas: [
      "Environmental Protection",
      "Public Lands and Natural Resources",
      "Water Resources Development",
    ],
    line: "bg-line-environment",
  },
  {
    label: "Immigration",
    policyAreas: ["Immigration"],
    line: "bg-line-immigration",
  },
  {
    label: "Crime & Justice",
    policyAreas: ["Crime and Law Enforcement", "Law"],
    line: "bg-line-justice",
  },
  {
    label: "Civil Rights",
    policyAreas: ["Civil Rights and Liberties, Minority Issues"],
    line: "bg-line-civil-rights",
  },
  {
    label: "Technology",
    policyAreas: ["Science, Technology, Communications"],
    line: "bg-line-technology",
  },
  {
    label: "Foreign Affairs",
    policyAreas: [
      "International Affairs",
      "Foreign Trade and International Finance",
    ],
    line: "bg-line-foreign",
  },
  {
    label: "Housing",
    policyAreas: ["Housing and Community Development"],
    line: "bg-line-housing",
  },
  {
    label: "Transportation",
    policyAreas: ["Transportation and Public Works"],
    line: null,
  },
  {
    label: "Agriculture",
    policyAreas: ["Agriculture and Food"],
    line: null,
  },
  {
    label: "Energy",
    policyAreas: ["Energy"],
    line: null,
  },
  {
    label: "Government",
    policyAreas: ["Government Operations and Politics", "Congress", "Taxation"],
    line: null,
  },
  {
    label: "Families",
    policyAreas: ["Families", "Social Welfare"],
    line: null,
  },
  {
    label: "Labor",
    policyAreas: ["Labor and Employment"],
    line: null,
  },
  {
    label: "Commerce",
    policyAreas: ["Commerce"],
    line: null,
  },
];

/** Reverse lookup: CRS policyArea string -> TopicInfo */
const policyAreaToTopic = new Map<string, TopicInfo>();
for (const topic of TOPICS) {
  for (const area of topic.policyAreas) {
    policyAreaToTopic.set(area, topic);
  }
}

/** Get the user-friendly topic for a CRS policyArea, or null if unmapped */
export function getTopicForPolicyArea(
  policyArea: string | null,
): TopicInfo | null {
  if (!policyArea) return null;
  return policyAreaToTopic.get(policyArea) ?? null;
}
