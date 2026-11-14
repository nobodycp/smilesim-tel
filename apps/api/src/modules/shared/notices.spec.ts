import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import type { TransferKind } from '../office/transfers/transfer-rules';
import { UnitOfWork } from '../office/kernel/unit-of-work';
import type { TransferNoticePayload } from './notices';

// The two ports of slice R.2 hold contracts, not rules (corrections to R.2): what a notice is and what an activity
// event says, and nothing that decides. And a unit of work with no notice writer does not start: notices are never
// dropped because a provider is missing.

// Compile-time, so a change to either side fails the typecheck: a transfer notice's kind is a transfer's kind,
// both ways. The contract cannot import the transfers' type (the platform imports no module above it).
const toNotice = (kind: TransferKind): TransferNoticePayload['kind'] => kind;
const toTransfer = (kind: TransferNoticePayload['kind']): TransferKind => kind;

const source = (name: string) => readFileSync(join(__dirname, name), 'utf8');
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('the platform’s ports are contracts', () => {
  it('a transfer notice and a transfer name the same kinds', () => {
    expect(['line', 'pos', 'agent'].map((kind) => toTransfer(toNotice(kind as TransferKind)))).toEqual(['line', 'pos', 'agent']);
  });

  it('shared/notices.ts holds types, the port and its token: no function, no import but a type', () => {
    const text = code(source('notices.ts'));
    expect(text.match(/^import .*$/gm)).toEqual(["import type { Prisma } from '../../generated/prisma/client';"]);
    expect(text).not.toMatch(/\bfunction\b|=>\s*[^;]*\{|\bclass\b/);
    expect(text.match(/^export const .*$/gm)).toEqual(["export const NOTICE_WRITER = Symbol('NOTICE_WRITER');"]);
  });

  it('shared/activity.ts holds the action list, the draft and an abstract recorder: no rule, no implementation', () => {
    const text = code(source('activity.ts'));
    expect(text.match(/^import .*$/gm)).toEqual(["import type { Gate } from './cookies';"]);
    expect(text).toMatch(/export abstract class ActivityRecorder \{/);
    expect(text).not.toMatch(/\bfunction\b|\bnew \w+\(|prisma|activityEvent/i);
  });

  it('a unit of work without the notice writer does not start: Nest refuses to build it', async () => {
    await expect(Test.createTestingModule({ providers: [UnitOfWork] }).compile()).rejects.toThrow(/NOTICE_WRITER/);
  });
});
