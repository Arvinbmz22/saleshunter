export type IranVerificationStatus =
  | "VERIFIED_IRAN"
  | "LIKELY_IRAN"
  | "UNCERTAIN"
  | "NOT_IRAN"
  | "NOT_APPLICABLE";

export type EvidenceStrength = "weak" | "moderate" | "strong";

export type EvidenceItem = {
  type: string;
  signal: string;
  sourceUrl: string | null;
  sourceId: string;
  strength: EvidenceStrength;
};

export type ScoreBreakdown = {
  businessAuthenticity: number;
  commercialIntent: number;
  onlineShopStrength: number;
  customerMessagePotential: number;
  shopBotFit: number;
  catalogComplexity: number;
  activityRecency: number;
  contactability: number;
  credibilityScale: number;
};

export type LeadTier = "HOT" | "HIGH" | "MEDIUM" | "LOW" | "REJECT";

export type ActivityStatus = "ACTIVE" | "INACTIVE" | "UNKNOWN";
export type Knownness = "known" | "estimated" | "unknown";
export type VerificationStatus =
  | "VERIFIED"
  | "LIKELY"
  | "UNCERTAIN"
  | "REJECTED"
  | "UNKNOWN";

export type Lead = {
  username: string | null;
  instagramUrl: string | null;
  businessName: string | null;
  category: string | null;
  city: string | null;
  country: string | null;
  bio: string | null;
  website: string | null;
  telegram: string | null;
  whatsapp: string | null;
  followers: number | null;
  businessType: string | null;
  evidence: EvidenceItem[];
  sourceUrls: string[];

  score: number;
  scoreBreakdown: ScoreBreakdown;
  tier: LeadTier;
  reason: string[];

  provider: string;
  discoveredAt: string;

  iranVerificationStatus: IranVerificationStatus;
  iranVerificationScore: number;
  iranConfidence: number;
  iranEvidence: EvidenceItem[];

  businessVerificationStatus: VerificationStatus;
  businessConfidence: number;

  onlineShopVerificationStatus: VerificationStatus;
  onlineShopConfidence: number;

  activityStatus: ActivityStatus;
  activityConfidence: number;

  customerMessagePotential: number;
  customerMessageConfidence: number;

  shopBotFit: number;
  shopBotFitConfidence: number;

  catalogKnownness: Knownness;
  credibilityScore: number;
  evidenceQualityScore: number;
  overallConfidence: number;

  rejectionReason: string | null;
  verificationWarnings: string[];
};

export type SearchRequest = {
  category: string;
  country: string;
  city?: string;
  limit: number;
};

export type SearchStats = {
  requested: number;
  accepted: number;
  duplicatesRemoved: number;
  irrelevantRejected: number;
  iranRejected: number;
  otherRejected: number;
  mockMode: boolean;
};

export type PipelineStage =
  | "generate_queries"
  | "public_search"
  | "extract_candidates"
  | "iran_verification"
  | "business_verification"
  | "online_shop_verification"
  | "commercial_activity"
  | "shopbot_fit"
  | "dedupe"
  | "ranking"
  | "finalize";

export type ProgressEvent = {
  stage: PipelineStage;
  label: string;
  detail?: string;
  current?: number;
  total?: number;
};

export type SearchResultItem = {
  title: string;
  url: string;
  snippet: string;
  query: string;
  provider: string;
};
