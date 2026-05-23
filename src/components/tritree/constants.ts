import { DEFAULT_ARTIFACT_TYPE_ID } from "@/lib/domain";
import type { RootSetupDefaults } from "./types";

export const MOBILE_LAYOUT_QUERY = "(max-width: 980px)";

export function mobilePanelClassName(panel: "tree" | "artifact", extraClassName?: string) {
  return `mobile-panel mobile-panel--${panel}${extraClassName ? ` ${extraClassName}` : ""}`;
}

export const emptyRootSetupDefaults: RootSetupDefaults = {
  artifactTypeId: DEFAULT_ARTIFACT_TYPE_ID,
  creationRequest: "",
  enabledSkillIds: [],
  seed: ""
};
