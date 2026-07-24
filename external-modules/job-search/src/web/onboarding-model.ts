export const PROFILE_FIELDS = [
  { id: "target-roles", label: "Target roles" },
  { id: "experience", label: "Experience" },
  { id: "compensation", label: "Compensation" },
  { id: "work-mode", label: "Work mode" },
  { id: "locations", label: "Locations" },
  { id: "dealbreakers", label: "Dealbreakers" },
  { id: "resume", label: "Resume" },
  { id: "search-status", label: "Search status" }
] as const;

export const INLINE_CONTROL_SLOTS = ["resume-intake", "profile-chips", "source-controls"] as const;
