export interface Link {
  id: number;
  url: string;
  title: string;
  note: string;
  saverName: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserSession {
  partnerName: string;
  coupleCode: string;
}

export type ScreenType = "login" | "list" | "detail";

export interface NavigationState {
  screen: ScreenType;
  selectedLinkId?: number;
}
