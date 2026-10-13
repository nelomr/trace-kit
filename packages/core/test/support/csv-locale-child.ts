import { exportCsv } from "../../src/export/csv.js";
import { buildLocaleFixture } from "./csv-fixture.js";

// Runs under a non-default process locale; prints a locale probe line, then the CSV bytes.
const probe = (1.5).toLocaleString();
let body = "";
for (const chunk of exportCsv(buildLocaleFixture(), -Infinity, Infinity)) body += chunk;
process.stdout.write(probe + "\u0000" + body);
