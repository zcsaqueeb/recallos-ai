/** Shared Tatum error + timeout constants — imported by grpc.ts and client.ts without cycles. */

export const TATUM_TIMEOUT_MS = Number(process.env.TATUM_TIMEOUT_MS || 12_000);

export class TatumError extends Error {
  code: string;
  detail?: string;
  constructor(code: string, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.code = code;
    this.detail = detail;
  }
}
