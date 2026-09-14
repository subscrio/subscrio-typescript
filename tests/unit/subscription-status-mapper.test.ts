import { describe, expect, test } from 'vitest';
import { SubscriptionMapper } from '../../src/application/mappers/SubscriptionMapper.js';
import { SubscriptionStatus } from '../../src/domain/value-objects/SubscriptionStatus.js';

describe('SubscriptionMapper status parse/format', () => {
  test('parses cancellation_pending from the status view', () => {
    expect(SubscriptionMapper.parseStatus('cancellation_pending')).toBe(SubscriptionStatus.CancellationPending);
  });

  test('parses hyphenated and mixed-case statuses', () => {
    expect(SubscriptionMapper.parseStatus('Cancellation-Pending')).toBe(SubscriptionStatus.CancellationPending);
    expect(SubscriptionMapper.parseStatus('CANCELED')).toBe(SubscriptionStatus.Cancelled);
    expect(SubscriptionMapper.parseStatus('cancelled')).toBe(SubscriptionStatus.Cancelled);
  });

  test('formats cancellation_pending as snake_case', () => {
    expect(SubscriptionMapper.formatStatus(SubscriptionStatus.CancellationPending)).toBe('cancellation_pending');
    expect(SubscriptionMapper.formatStatus(SubscriptionStatus.Active)).toBe('active');
  });

  test('throws on unknown status', () => {
    expect(() => SubscriptionMapper.parseStatus('not-a-status')).toThrow(/Unknown subscription status/);
  });
});
