export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export const API_VERSION = "v1";
