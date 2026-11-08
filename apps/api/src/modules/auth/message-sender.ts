import { Injectable, Logger } from '@nestjs/common';

// One way out for sign-in codes, by SMS or by email (spec 2026-11-08-signin-methods). The owner picks the gateways
// later; each is a class behind MESSAGE_SENDER. Until then LogSender writes the message to the server log.

export const MESSAGE_SENDER = Symbol('MESSAGE_SENDER');
export type MessageChannel = 'sms' | 'email';
export type OutgoingMessage = { channel: MessageChannel; to: string; subject: string; text: string };

export interface MessageSender {
  send(message: OutgoingMessage): Promise<void>;
}

@Injectable()
export class LogSender implements MessageSender {
  private readonly logger = new Logger('MessageSender');

  async send(message: OutgoingMessage): Promise<void> {
    this.logger.log(`[${message.channel}] to ${message.to}: ${message.text}`);
  }
}
