-- One outbox message per send of an operation (ADR 0017, attempt fencing): `sequence` is the number of attempts
-- already made when the message was written (0 for the first send), and the database refuses a second message
-- for the same send. Additive; the table has no reader yet.

ALTER TABLE "OutboxMessage" ADD COLUMN "sequence" INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX "OutboxMessage_topic_aggregateId_sequence_key" ON "OutboxMessage"("topic", "aggregateId", "sequence");
