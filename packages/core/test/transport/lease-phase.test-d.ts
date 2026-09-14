// Type-only fixture (buffer-ownership-protocol spec's "Compile-Time Phase Enforcement Plus
// Runtime Generation Guard", scenario "Passing an in-flight lease to an accessor does not
// type-check"). This file is never executed by Vitest; its only purpose is `tsc --noEmit`.
import type { Lease } from "../../src/transport/ownership.js";
import type { DecimationPort } from "../../src/transport/decimation-port.js";

declare const port: DecimationPort;
declare const acquiredLease: Lease<"acquired">;
declare const inflightLease: Lease<"inflight">;

// Positive control: an acquired-phase lease type-checks cleanly against every accessor.
port.viewX(acquiredLease);
port.viewY(acquiredLease);
port.viewOut(acquiredLease);
port.viewIndices(acquiredLease);

// @ts-expect-error — viewX accepts only Lease<'acquired'> | Lease<'settled'>; an in-flight
// lease must not type-check.
port.viewX(inflightLease);
// @ts-expect-error — same enforcement on viewY.
port.viewY(inflightLease);
// @ts-expect-error — same enforcement on viewOut.
port.viewOut(inflightLease);
// @ts-expect-error — same enforcement on viewIndices.
port.viewIndices(inflightLease);

// Runtime-level proof that the *type* guard, not the runtime guard, is what's under test here:
// `submit` still type-checks when the same acquired-phase value is passed twice — the double
// call is only rejected at runtime (buffer-pool.ts's generation compare), never at compile time.
port.submit(acquiredLease);
port.submit(acquiredLease);
