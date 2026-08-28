import { Logger } from '@nestjs/common';
import { EventCompletionScheduler } from './events.scheduler';
import type { EventModule } from './events.interface';

describe('EventCompletionScheduler', () => {
  it('uses the Event command seam to complete due events', async () => {
    const events = { decide: jest.fn().mockResolvedValue({ kind: 'DUE_EVENTS_COMPLETED', completedEventIds: [] }) } as unknown as EventModule;
    const scheduler = new EventCompletionScheduler(events);

    await scheduler.run();

    expect(events.decide).toHaveBeenCalledWith({ kind: 'COMPLETE_DUE_EVENTS' });
  });

  it('contains scheduled-runtime failures', async () => {
    const logError = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const events = { decide: jest.fn().mockRejectedValue(new Error('database unavailable')) } as unknown as EventModule;
    const scheduler = new EventCompletionScheduler(events);

    await expect(scheduler.run()).resolves.toBeUndefined();
    expect(logError).toHaveBeenCalledWith('Failed to complete due events.', expect.any(String));
    logError.mockRestore();
  });
});
