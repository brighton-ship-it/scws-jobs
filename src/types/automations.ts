// Automation types for SCWS

export type AutomationTrigger = 
  | 'appointment_scheduled'
  | 'job_completed'
  | 'quote_sent'
  | 'quote_approved'
  | 'invoice_sent'
  | 'invoice_paid'
  | 'vehicle_registration'
  | 'custom';

export type MessageType = 'sms' | 'email' | 'both';
export type SentMessageStatus = 'pending' | 'sent' | 'failed' | 'delivered';
export type TriggerEntityType = 'job' | 'quote' | 'invoice' | 'vehicle';

export interface Automation {
  id: string;
  name: string;
  description: string | null;
  trigger: AutomationTrigger;
  delay_hours: number;  // Positive = after, Negative = before
  message_type: MessageType;
  message_template: string;
  email_subject: string | null;
  is_active: boolean;
  sent_count: number;
  last_sent_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AutomationSentMessage {
  id: string;
  automation_id: string;
  customer_id: string;
  trigger_entity_id: string;
  trigger_entity_type: TriggerEntityType;
  message_type: 'sms' | 'email';
  recipient: string;
  message_content: string;
  status: SentMessageStatus;
  external_id: string | null;
  error_message: string | null;
  scheduled_for: string;
  sent_at: string | null;
  created_at: string;
}

export interface AutomationLog {
  id: string;
  automation_id: string | null;
  event_type: string;
  details: Record<string, any> | null;
  created_at: string;
}

// API types
export interface CreateAutomationInput {
  name: string;
  description?: string;
  trigger: AutomationTrigger;
  delay_hours: number;
  message_type: MessageType;
  message_template: string;
  email_subject?: string;
  is_active?: boolean;
}

export interface UpdateAutomationInput extends Partial<CreateAutomationInput> {
  id: string;
}

// Template variables available for each trigger type
export const TEMPLATE_VARIABLES: Record<AutomationTrigger, string[]> = {
  appointment_scheduled: ['customer_name', 'date', 'time', 'address', 'service_type', 'tech_name'],
  job_completed: ['customer_name', 'service_type', 'address', 'tech_name', 'job_number'],
  quote_sent: ['customer_name', 'service_type', 'amount', 'quote_number', 'valid_until'],
  quote_approved: ['customer_name', 'service_type', 'amount', 'quote_number'],
  invoice_sent: ['customer_name', 'invoice_number', 'amount', 'due_date', 'payment_link'],
  invoice_paid: ['customer_name', 'invoice_number', 'amount', 'payment_method'],
  vehicle_registration: ['vehicle_name', 'license_plate', 'registration_due_date', 'days_until_due', 'assigned_user'],
  custom: ['customer_name'],
};

export const TRIGGER_LABELS: Record<AutomationTrigger, string> = {
  appointment_scheduled: 'Appointment Scheduled',
  job_completed: 'Job Completed',
  quote_sent: 'Quote Sent',
  quote_approved: 'Quote Approved',
  invoice_sent: 'Invoice Sent',
  invoice_paid: 'Payment Received',
  vehicle_registration: 'Vehicle Registration Due',
  custom: 'Custom Trigger',
};

// Vehicle registration reminder intervals (days before due date)
export const VEHICLE_REGISTRATION_REMINDER_DAYS = [60, 30, 14, 7];
