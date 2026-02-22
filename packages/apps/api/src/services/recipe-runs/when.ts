import { getPathValue } from './template.js';

function stripWrapper(value: string): string {
  const trimmed = String(value || '').trim();
  if (trimmed.startsWith('{{') && trimmed.endsWith('}}')) {
    return trimmed.slice(2, -2).trim();
  }
  return trimmed;
}

function isTruthy(value: unknown): boolean {
  if (value == null) {
    return false;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  return true;
}

function evalAtom(atomRaw: string, ctx: Record<string, unknown>): boolean {
  const atom = atomRaw.trim();
  if (!atom) {
    return true;
  }

  if (atom.startsWith('!')) {
    return !evalAtom(atom.slice(1), ctx);
  }

  const compare = atom.match(
    /^([a-zA-Z0-9_$. -]+)\s*(==|!=)\s*(null|true|false|""|''|\d+(\.\d+)?)$/
  );
  if (compare) {
    const leftPath = compare[1].trim();
    const op = compare[2];
    const rightRaw = compare[3];

    const left = getPathValue(ctx, leftPath);

    let right: unknown;
    if (rightRaw === 'null') {
      right = null;
    } else if (rightRaw === 'true') {
      right = true;
    } else if (rightRaw === 'false') {
      right = false;
    } else if (rightRaw === '""' || rightRaw === "''") {
      right = '';
    } else {
      right = Number(rightRaw);
    }

    const eq = left === right || (right === null && left == null);
    return op === '==' ? eq : !eq;
  }

  const exists = atom.match(/^([a-zA-Z0-9_$. -]+)\s*(!=|==)\s*undefined$/);
  if (exists) {
    const leftPath = exists[1].trim();
    const op = exists[2];
    const left = getPathValue(ctx, leftPath);
    const eq = typeof left === 'undefined';
    return op === '==' ? eq : !eq;
  }

  return isTruthy(getPathValue(ctx, atom));
}

function splitByOperator(expr: string, operator: '||' | '&&'): string[] {
  const parts: string[] = [];
  let buf = '';
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    const next = expr[i + 1];
    if (c === operator[0] && next === operator[1]) {
      parts.push(buf);
      buf = '';
      i++;
      continue;
    }
    buf += c;
  }
  parts.push(buf);
  return parts;
}

export function evalWhen(exprRaw: string | undefined, ctx: Record<string, unknown>): boolean {
  if (!exprRaw) {
    return true;
  }
  const expr = stripWrapper(exprRaw);
  if (!expr) {
    return true;
  }

  const orParts = splitByOperator(expr, '||');
  return orParts.some((orPart) => {
    const andParts = splitByOperator(orPart, '&&');
    return andParts.every((andPart) => evalAtom(andPart, ctx));
  });
}
