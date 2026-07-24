export interface NetworkRequestInfo {
  /** Numero sequencial exibido pelo @playwright/mcp (ex: "21." em "21. [GET] ..."). Usado para diff antes/depois de uma acao. */
  sequence: number;
  url: string;
  method: string;
  status: number | null;
}

export interface ConsoleMessageInfo {
  type: string;
  text: string;
}

export interface TabInfo {
  index: number;
  url: string;
  title: string;
  active: boolean;
}

export type MouseButton = "left" | "right" | "middle";
