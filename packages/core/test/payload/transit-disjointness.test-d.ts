// Type-only fixture (spectrum-data-payload spec's "A payload buffer is rejected by the
// transfer-list builder" scenario). Never executed by Vitest; checked only by `tsc --noEmit`.
import type { TransferableBacking } from "../../src/buffers/brand.js";
import type { SpectrumDataPayload } from "../../src/payload/spectrum-data-payload.js";

declare function acceptsTransferable(buf: TransferableBacking): void;
declare const payload: SpectrumDataPayload;

// @ts-expect-error — a payload's X buffer is Retained, never Transit; it must not satisfy a
// TransferableBacking (Transit-only) parameter.
acceptsTransferable(payload.x);
