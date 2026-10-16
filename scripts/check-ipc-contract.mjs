// Checks the window.api contract (src/preload/api.d.ts → IpcInvokeMap)
// against the real ipcMain.handle registrations in src/main, using the
// TypeScript checker on the same program `tsc -b` builds for tsconfig.node.
//
// Run via `npm run check:ipc` (part of `npm run check`). A handler that
// changes its return shape or arguments without the contract following
// (or the other way round) fails the check:
//
//   CHANNEL  a handled channel missing from the contract, or a contract
//            channel nobody handles
//   RESULT   the handler's awaited result is not assignable to the contract
//            result, or it returns a field (top-level, nested or inside array
//            elements) that the contract does not declare
//   ARGS     a contract argument the handler does not take or whose type it
//            does not accept, or a handler parameter the contract never sends
//
// Findings print as `<KIND> <file>:<line>  <msg>`; any finding exits 1.

import path from 'path';
import { fileURLToPath } from 'url';
import ts from 'typescript';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONTRACT_FILE = path.join(ROOT, 'src/preload/api.d.ts');
const MAIN_DIR = path.join(ROOT, 'src/main') + path.sep;

const program = createProgram(path.join(ROOT, 'tsconfig.node.json'));
const checker = program.getTypeChecker();
const findings = [];

const contract = readContract();
const handled = new Set();

for (const sf of program.getSourceFiles()) {
  if (!path.resolve(sf.fileName).startsWith(MAIN_DIR)) continue;
  const visit = (node) => {
    if (isIpcHandle(node)) checkHandler(node);
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

for (const [channel, { decl }] of contract) {
  if (!handled.has(channel)) report('CHANNEL', decl, `'${channel}' is in the contract but no ipcMain.handle registers it`);
}

if (findings.length === 0) {
  console.log(`check:ipc: clean — ${handled.size} handlers match ${contract.size} contract channels`);
  process.exit(0);
}
for (const f of findings) console.log(`${f.kind.padEnd(8)} ${f.where}  ${f.msg}`);
console.log(`\ncheck:ipc: ${findings.length} finding(s) — update the handler or src/preload/api.d.ts so they agree`);
process.exit(1);

// ---------------------------------------------------------------------------

function createProgram(configPath) {
  const { config, error } = ts.readConfigFile(configPath, ts.sys.readFile);
  if (error) throw new Error(ts.flattenDiagnosticMessageText(error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(config, ts.sys, path.dirname(configPath));
  // composite/incremental only matter to `tsc -b`; a plain program is enough here.
  return ts.createProgram(parsed.fileNames, { ...parsed.options, composite: false, incremental: false });
}

function readContract() {
  const sf = program.getSourceFile(CONTRACT_FILE.replace(/\\/g, '/'));
  const decl = sf?.statements.find(s => ts.isInterfaceDeclaration(s) && s.name.text === 'IpcInvokeMap');
  if (!decl) throw new Error('IpcInvokeMap not found in src/preload/api.d.ts');
  const map = new Map();
  for (const member of decl.members) {
    const symbol = checker.getSymbolAtLocation(member.name);
    const sig = checker.getTypeOfSymbolAtLocation(symbol, member).getCallSignatures()[0];
    if (!sig) throw new Error(`IpcInvokeMap['${symbol.name}'] is not a function type`);
    if (sig.getReturnType().flags & ts.TypeFlags.Any) {
      report('RESULT', member, `'${symbol.name}' contract result is any — every handler result would pass; use a real type (or unknown)`);
    }
    map.set(symbol.name, { decl: member, sig });
  }
  return map;
}

// ipcMain.handle(<channel>, <handler>) / ipcMain.handleOnce(...)
function isIpcHandle(node) {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return false;
  const { expression, name } = node.expression;
  return ts.isIdentifier(expression) && expression.text === 'ipcMain'
    && (name.text === 'handle' || name.text === 'handleOnce');
}

function checkHandler(call) {
  const [channelArg, fn] = call.arguments;
  if (!channelArg || !ts.isStringLiteralLike(channelArg)) {
    report('CHANNEL', call, 'channel is not a string literal — the contract check cannot follow it');
    return;
  }
  const channel = channelArg.text;
  handled.add(channel);
  const entry = contract.get(channel);
  if (!entry) {
    report('CHANNEL', call, `'${channel}' is handled here but missing from IpcInvokeMap`);
    return;
  }
  const sig = fn && checker.getTypeAtLocation(fn).getCallSignatures()[0];
  if (!sig) {
    report('RESULT', call, `'${channel}' handler has no call signature`);
    return;
  }
  checkResult(channel, call, sig, entry.sig);
  checkArgs(channel, call, sig, entry.sig);
}

function checkResult(channel, call, sig, contractSig) {
  const expected = contractSig.getReturnType();
  const actual = checker.getAwaitedType(sig.getReturnType()) ?? sig.getReturnType();
  if (actual.flags & ts.TypeFlags.Any) {
    report('RESULT', call, `'${channel}' handler resolves to any — give it a real type so the contract can be checked`);
    return;
  }
  let assignable = true;
  for (const part of members(actual)) {
    if (!checker.isTypeAssignableTo(part, expected)) {
      report('RESULT', call, `'${channel}' handler resolves to ${show(part)}, not assignable to contract ${show(expected)}`);
      assignable = false;
    }
  }
  if (!assignable) return;
  // Assignability lets extra fields through, so a field the handler starts
  // returning would never reach the contract. Look for them explicitly.
  for (const field of extraFields(actual, [expected], '', 0)) {
    report('RESULT', call, `'${channel}' handler returns field '${field}' that the contract result does not declare`);
  }
}

// Field paths (`a`, `a.b`, `list[].c`) present in `actual` but in none of the
// `expected` types it is assignable to. Follows object fields and array
// elements a few levels down; stops where both sides share the same type.
function extraFields(actual, expected, trail, depth) {
  if (depth > 4) return [];
  const out = [];
  for (const part of members(actual)) {
    const targets = expected.flatMap(members).filter(t => checker.isTypeAssignableTo(part, t));
    if (targets.length === 0 || targets.includes(part)) continue;
    if (checker.isArrayType(part)) {
      if (targets.every(t => checker.isArrayType(t))) {
        out.push(...extraFields(elementType(part), targets.map(elementType), `${trail}[]`, depth + 1));
      }
      continue;
    }
    if (!isPlainObject(part) || !targets.every(isPlainObject)) continue;
    for (const prop of checker.getPropertiesOfType(part)) {
      if (isUnionPadding(prop)) continue;
      const matches = targets.map(t => checker.getPropertyOfType(t, prop.name)).filter(Boolean);
      const field = `${trail}${trail && !trail.endsWith('.') ? '.' : ''}${prop.name}`;
      if (matches.length === 0) {
        out.push(field);
        continue;
      }
      out.push(...extraFields(checker.getTypeOfSymbol(prop), matches.map(p => checker.getTypeOfSymbol(p)), field, depth + 1));
    }
  }
  return [...new Set(out)];
}

function checkArgs(channel, call, sig, contractSig) {
  const handlerParams = sig.getParameters().slice(1); // [0] is the IpcMainInvokeEvent
  const contractParams = contractSig.getParameters();
  contractParams.forEach((cp, i) => {
    const hp = handlerParams[i];
    if (!hp) {
      report('ARGS', call, `'${channel}' contract sends '${cp.name}' but the handler takes no parameter for it`);
      return;
    }
    const sent = checker.getTypeOfSymbol(cp);
    const accepted = checker.getTypeOfSymbol(hp);
    if (!checker.isTypeAssignableTo(sent, accepted)) {
      report('ARGS', call, `'${channel}' contract '${cp.name}: ${show(sent)}' is not accepted by handler '${hp.name}: ${show(accepted)}'`);
    }
  });
  for (const hp of handlerParams.slice(contractParams.length)) {
    report('ARGS', call, `'${channel}' handler takes '${hp.name}' but the contract never sends it`);
  }
}

// ---------------------------------------------------------------------------

function members(type) {
  return type.isUnion() ? type.types : [type];
}

// An object shape whose fields are worth comparing — including intersections
// such as `{ ok: true } & T`, but not arrays, tuples or functions.
function isPlainObject(type) {
  if (type.isIntersection()) return type.types.every(isPlainObject);
  return !!(type.flags & ts.TypeFlags.Object) && !checker.isArrayType(type) && !checker.isTupleType(type)
    && type.getCallSignatures().length === 0;
}

function elementType(arrayType) {
  return checker.getTypeArguments(arrayType)[0];
}

// Return-type inference pads each object literal in a union with the other
// members' fields as `field?: undefined`; those are not real fields.
function isUnionPadding(prop) {
  return !!(prop.flags & ts.SymbolFlags.Optional)
    && !!(checker.getTypeOfSymbol(prop).flags & ts.TypeFlags.Undefined);
}

function show(type) {
  return checker.typeToString(type, undefined, ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope);
}

function report(kind, node, msg) {
  const sf = node.getSourceFile();
  const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  findings.push({ kind, where: `${path.relative(ROOT, sf.fileName).replace(/\\/g, '/')}:${line}`, msg });
}
