/**
 * Live smoke test — Tatum Sui gRPC gateway (sui-mainnet-grpc.gateway.tatum.io:443).
 * Validates the vendored protos + @grpc/grpc-js stack under bun BEFORE the
 * client.ts migration. Run: bun scripts/smoke-grpc.ts
 */
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import path from "path";

const ROOT = path.join(process.cwd(), "vendor", "sui-grpc-proto");
const KEY = process.env.TATUM_API_KEY || "";
if (!KEY) {
  console.error("TATUM_API_KEY missing");
  process.exit(1);
}

const opts: protoLoader.Options = {
  includeDirs: [ROOT],
  keepCase: false,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
};
const def = await protoLoader.load("sui/rpc/v2/ledger_service.proto", opts);
const pkg = grpc.loadPackageDefinition(def) as any;
const stateDef = await protoLoader.load("sui/rpc/v2/state_service.proto", opts);
const statePkg = grpc.loadPackageDefinition(stateDef) as any;
const Ledger = pkg.sui.rpc.v2.LedgerService;
const State = statePkg.sui.rpc.v2.StateService;
const FieldMask = pkg.google.protobuf.FieldMask;
console.log("protos loaded. FieldMask ctor:", typeof FieldMask, "| Ledger:", typeof Ledger, "| State:", typeof State);

const HOST = "sui-mainnet-grpc.gateway.tatum.io:443";
const meta = new grpc.Metadata();
meta.set("x-api-key", KEY);
const deadline = Date.now() + 15_000;

function call<C>(client: C, method: string, req: Record<string, unknown>): Promise<any> {
  return new Promise((resolve, reject) => {
    (client as any)[method](req, meta, { deadline }, (err: grpc.ServiceError | null, res: unknown) => {
      if (err) reject(err);
      else resolve(res);
    });
  });
}

const ledger = new Ledger(HOST, grpc.credentials.createSsl());
const state = new State(HOST, grpc.credentials.createSsl());

const t0 = Date.now();
const info = await call(ledger, "getServiceInfo", {});
console.log(`\n[GetServiceInfo] ${Date.now() - t0}ms`);
console.log(JSON.stringify(info, null, 2).slice(0, 600));

const t1 = Date.now();
const cp = await call(ledger, "getCheckpoint", {
  readMask: { paths: ["sequence_number", "digest", "summary.epoch", "summary.timestamp"] },
});
console.log(`\n[GetCheckpoint latest] ${Date.now() - t1}ms`);
console.log(JSON.stringify(cp, null, 2).slice(0, 600));

const addr = process.env.WALRUS_MEMORY_ACCOUNT_ID || "0x9451b08a68feca67f44307e0a56298cfbf8ecd1857dd2d849555c866be69aae3";
const t2 = Date.now();
const bal = await call(state, "getBalance", { owner: addr, coinType: "0x2::sui::SUI" });
console.log(`\n[GetBalance ${addr.slice(0, 10)}…] ${Date.now() - t2}ms`);
console.log(JSON.stringify(bal, null, 2).slice(0, 400));

const t3 = Date.now();
const owned = await call(state, "listOwnedObjects", {
  owner: addr,
  pageSize: 5,
  readMask: { paths: ["object_id", "version", "digest", "object_type", "has_public_transfer"] },
});
console.log(`\n[ListOwnedObjects] ${Date.now() - t3}ms`);
console.log(JSON.stringify(owned, null, 2).slice(0, 700));

const t4 = Date.now();
const bals = await call(state, "listBalances", { owner: addr, pageSize: 12 });
console.log(`\n[ListBalances] ${Date.now() - t4}ms`);
console.log(JSON.stringify(bals, null, 2).slice(0, 500));

console.log("\nALL SMOKE CALLS OK");
process.exit(0);
