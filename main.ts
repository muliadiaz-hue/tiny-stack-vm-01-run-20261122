// Tiny stack VM (make.fun tiny-stack-vm-01), written from the kit ISA.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function runVM(prog: Buffer, input: Buffer): { code: number; data: Uint8Array } {
  const stack = new Int32Array(256);
  const calls = new Int32Array(64);
  const mem = new Int32Array(256);
  const out = new Uint8Array(65536);
  let sp = 0, cp = 0, pc = 0, steps = 0, inPos = 0, outLen = 0;
  const done = (code: number) => ({ code, data: out.subarray(0, outLen) });
  for (;;) {
    if (steps >= 1000000) return done(10);
    if (pc < 0 || pc >= prog.length) return done(9);
    const op = prog[pc];
    steps++;
    switch (op) {
      case 0x00: return done(0);
      case 0x01:
        if (pc + 2 > prog.length) return done(9);
        if (sp >= 256) return done(3);
        stack[sp++] = (prog[pc + 1] << 24) >> 24;
        pc += 2;
        break;
      case 0x02:
        if (pc + 5 > prog.length) return done(9);
        if (sp >= 256) return done(3);
        stack[sp++] = prog[pc + 1] | (prog[pc + 2] << 8) | (prog[pc + 3] << 16) | (prog[pc + 4] << 24);
        pc += 5;
        break;
      case 0x03:
        if (sp < 1) return done(2);
        sp--;
        pc++;
        break;
      case 0x04:
        if (sp < 1) return done(2);
        if (sp >= 256) return done(3);
        stack[sp] = stack[sp - 1];
        sp++;
        pc++;
        break;
      case 0x05:
        if (sp < 2) return done(2);
        [stack[sp - 1], stack[sp - 2]] = [stack[sp - 2], stack[sp - 1]];
        pc++;
        break;
      case 0x06:
        if (sp < 2) return done(2);
        if (sp >= 256) return done(3);
        stack[sp] = stack[sp - 2];
        sp++;
        pc++;
        break;
      case 0x07:
        if (sp < 3) return done(2);
        [stack[sp - 3], stack[sp - 2], stack[sp - 1]] = [stack[sp - 2], stack[sp - 1], stack[sp - 3]];
        pc++;
        break;
      case 0x17:
        if (sp < 1) return done(2);
        stack[sp - 1] = (-stack[sp - 1]) | 0;
        pc++;
        break;
      case 0x1b:
        if (sp < 1) return done(2);
        stack[sp - 1] = ~stack[sp - 1];
        pc++;
        break;
      case 0x10: case 0x11: case 0x12: case 0x13: case 0x14: case 0x15: case 0x16:
      case 0x18: case 0x19: case 0x1a: case 0x1c: case 0x1d: case 0x1e:
      case 0x20: case 0x21: case 0x22: {
        if (sp < 2) return done(2);
        const b = stack[--sp];
        const a = stack[sp - 1];
        let r: number;
        switch (op) {
          case 0x10: r = (a + b) | 0; break;
          case 0x11: r = (a - b) | 0; break;
          case 0x12: r = Math.imul(a, b); break;
          case 0x13:
            if (b === 0) return done(4);
            r = Math.trunc(a / b) | 0;
            break;
          case 0x14:
            if (b === 0) return done(4);
            r = (a % b) | 0;
            break;
          case 0x15:
            if (b === 0) return done(4);
            r = Math.trunc((a >>> 0) / (b >>> 0)) | 0;
            break;
          case 0x16:
            if (b === 0) return done(4);
            r = ((a >>> 0) % (b >>> 0)) | 0;
            break;
          case 0x18: r = a & b; break;
          case 0x19: r = a | b; break;
          case 0x1a: r = a ^ b; break;
          case 0x1c: r = a << (b & 31); break;
          case 0x1d: r = a >> (b & 31); break;
          case 0x1e: r = (a >>> (b & 31)) | 0; break;
          case 0x20: r = a === b ? 1 : 0; break;
          case 0x21: r = a < b ? 1 : 0; break;
          default: r = (a >>> 0) < (b >>> 0) ? 1 : 0; break;
        }
        stack[sp - 1] = r;
        pc++;
        break;
      }
      case 0x30:
        if (pc + 3 > prog.length) return done(9);
        pc = pc + 3 + ((prog[pc + 1] | (prog[pc + 2] << 8)) << 16 >> 16);
        break;
      case 0x31: case 0x32: {
        if (pc + 3 > prog.length) return done(9);
        if (sp < 1) return done(2);
        const v = stack[--sp];
        const off = (prog[pc + 1] | (prog[pc + 2] << 8)) << 16 >> 16;
        pc = (op === 0x31 ? v === 0 : v !== 0) ? pc + 3 + off : pc + 3;
        break;
      }
      case 0x33:
        if (pc + 3 > prog.length) return done(9);
        if (cp >= 64) return done(7);
        calls[cp++] = pc + 3;
        pc = prog[pc + 1] | (prog[pc + 2] << 8);
        break;
      case 0x34:
        if (cp === 0) return done(8);
        pc = calls[--cp];
        break;
      case 0x40:
        if (sp < 1) return done(2);
        if (stack[sp - 1] < 0 || stack[sp - 1] > 255) return done(6);
        stack[sp - 1] = mem[stack[sp - 1]];
        pc++;
        break;
      case 0x41: {
        if (sp < 2) return done(2);
        if (stack[sp - 1] < 0 || stack[sp - 1] > 255) return done(6);
        mem[stack[sp - 1]] = stack[sp - 2];
        sp -= 2;
        pc++;
        break;
      }
      case 0x50: {
        if (sp < 1) return done(2);
        const text = String(stack[--sp]);
        if (outLen + text.length > 65536) return done(11);
        for (let i = 0; i < text.length; i++) out[outLen++] = text.charCodeAt(i);
        pc++;
        break;
      }
      case 0x51:
        if (sp < 1) return done(2);
        if (outLen >= 65536) return done(11);
        out[outLen++] = stack[--sp] & 255;
        pc++;
        break;
      case 0x52:
        if (sp >= 256) return done(3);
        stack[sp++] = inPos < input.length ? input[inPos++] : -1;
        pc++;
        break;
      case 0x53:
        if (sp < 1) return done(2);
        return done(stack[--sp] & 255);
      default: return done(5);
    }
  }
}

const inputDir = process.env.MAKEFUN_INPUT_DIR ?? "/input";
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
for (let i = 1; i <= 40; i++) {
  const id = "i" + String(i).padStart(3, "0");
  let prog: Buffer;
  try {
    prog = readFileSync(join(inputDir, id, "program.bin"));
  } catch {
    continue;
  }
  let input = Buffer.alloc(0);
  try {
    input = readFileSync(join(inputDir, id, "input.bin"));
  } catch {
  }
  const { code, data } = runVM(prog, input);
  const dir = join(outputDir, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "stdout.bin"), data);
  writeFileSync(join(dir, "exit.txt"), String(code) + "\n");
}
