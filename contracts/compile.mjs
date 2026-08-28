// Compile contracts/WrappedISK.sol -> contracts/build/WrappedISK.json
// Run: bun contracts/compile.mjs
import solc from "solc";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const SOURCE = "WrappedISK.sol";

function readImport(importPath) {
  let file;
  if (importPath.startsWith("@openzeppelin/")) {
    file = path.join(root, "node_modules", importPath);
  } else {
    file = path.join(here, importPath);
  }
  try {
    return { contents: fs.readFileSync(file, "utf8") };
  } catch (e) {
    return { error: `Not found: ${importPath} (${file})` };
  }
}

const input = {
  language: "Solidity",
  sources: { [SOURCE]: { content: fs.readFileSync(path.join(here, SOURCE), "utf8") } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: "cancun",
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "metadata"] } },
  },
};

const out = JSON.parse(solc.compile(JSON.stringify(input), { import: readImport }));

const errors = (out.errors ?? []).filter((e) => e.severity === "error");
for (const e of out.errors ?? []) console.log(e.formattedMessage);
if (errors.length) process.exit(1);

const c = out.contracts[SOURCE]["WrappedISK"];
const buildDir = path.join(here, "build");
fs.mkdirSync(buildDir, { recursive: true });
fs.writeFileSync(
  path.join(buildDir, "WrappedISK.json"),
  JSON.stringify(
    {
      contractName: "WrappedISK",
      compiler: solc.version(),
      abi: c.abi,
      bytecode: "0x" + c.evm.bytecode.object,
      metadata: c.metadata,
    },
    null,
    2,
  ),
);

// Standard-JSON input for Etherscan verification (with all sources inlined).
const sources = { [SOURCE]: input.sources[SOURCE] };
const seen = new Set([SOURCE]);
const queue = [SOURCE];
while (queue.length) {
  const f = queue.shift();
  const content = sources[f].content;
  for (const m of content.matchAll(/import\s+(?:\{[^}]*\}\s+from\s+)?["']([^"']+)["']/g)) {
    const dep = m[1];
    if (seen.has(dep)) continue;
    const r = readImport(dep);
    if (r.error) throw new Error(r.error);
    seen.add(dep);
    sources[dep] = { content: r.contents };
    queue.push(dep);
  }
}
fs.writeFileSync(
  path.join(buildDir, "verify-input.json"),
  JSON.stringify({ ...input, sources }, null, 2),
);

console.log("Compiled WrappedISK");
console.log("  solc:     ", solc.version());
console.log("  bytecode: ", c.evm.bytecode.object.length / 2, "bytes");
console.log("  sources:  ", Object.keys(sources).length);
