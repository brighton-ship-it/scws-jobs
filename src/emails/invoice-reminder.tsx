import {
  Button,
  Heading,
  Hr,
  Section,
  Text,
} from '@react-email/components';
import * as React from 'react';
import { BaseLayout } from './base-layout';

interface InvoiceReminderEmailProps {
  customerName: string;
  invoiceNumber: string;
  amount: string;
  dueDate: string;
  daysOverdue: number;
  paymentUrl: string;
}

export function InvoiceReminderEmail({
  customerName = 'Robert',
  invoiceNumber = 'INV-2024-00001',
  amount = '$450.00',
  dueDate = 'January 15, 2025',
  daysOverdue = 7,
  paymentUrl = 'https://pay.scwellservice.com/inv/abc123',
}: InvoiceReminderEmailProps) {
  const isOverdue = daysOverdue > 0;

  return (
    <BaseLayout preview={`Payment reminder: Invoice ${invoiceNumber} - ${amount}`}>
      {isOverdue && (
        <Section style={alertBanner}>
          <Text style={alertText}>⚠️ Payment Overdue</Text>
        </Section>
      )}

      <Heading style={heading}>
        {isOverdue ? 'Payment Reminder' : 'Upcoming Payment Due'}
      </Heading>
      
      <Text style={paragraph}>
        Hi {customerName},
      </Text>
      
      <Text style={paragraph}>
        {isOverdue 
          ? `This is a friendly reminder that your invoice is ${daysOverdue} day${daysOverdue !== 1 ? 's' : ''} overdue.`
          : 'This is a friendly reminder that your invoice will be due soon.'
        }
      </Text>

      <Section style={isOverdue ? overdueCard : invoiceCard}>
        <table style={invoiceHeader}>
          <tbody>
            <tr>
              <td>
                <Text style={invoiceLabel}>Invoice</Text>
                <Text style={invoiceNumberStyle}>{invoiceNumber}</Text>
              </td>
              <td style={{ textAlign: 'right' as const }}>
                <Text style={invoiceLabel}>Amount Due</Text>
                <Text style={isOverdue ? amountOverdue : amountDue}>{amount}</Text>
              </td>
            </tr>
          </tbody>
        </table>

        <Hr style={divider} />

        <table style={detailsTable}>
          <tbody>
            <tr>
              <td style={labelCell}>{isOverdue ? 'Was Due' : 'Due Date'}</td>
              <td style={isOverdue ? overdueValueCell : valueCell}>{dueDate}</td>
            </tr>
            {isOverdue && (
              <tr>
                <td style={labelCell}>Days Overdue</td>
                <td style={overdueValueCell}>{daysOverdue} days</td>
              </tr>
            )}
          </tbody>
        </table>
      </Section>

      <Section style={buttonSection}>
        <Button style={primaryButton} href={paymentUrl}>
          Pay Now - {amount}
        </Button>
      </Section>

      {isOverdue ? (
        <Text style={paragraph}>
          If you&apos;ve already sent payment, please disregard this reminder. If you&apos;re 
          experiencing any difficulties, please contact us to discuss payment options.
        </Text>
      ) : (
        <Text style={paragraph}>
          Please ensure payment is made by the due date to avoid any late fees.
        </Text>
      )}

      <Hr style={divider} />

      <Text style={contactText}>
        Questions about this invoice? Reply to this email or call us at (760) 555-0100.
      </Text>
    </BaseLayout>
  );
}

export default InvoiceReminderEmail;

const alertBanner = {
  backgroundColor: '#fef2f2',
  borderRadius: '8px',
  padding: '12px 16px',
  marginBottom: '24px',
  border: '1px solid #fecaca',
};

const alertText = {
  fontSize: '14px',
  fontWeight: '600' as const,
  color: '#dc2626',
  margin: '0',
  textAlign: 'center' as const,
};

const heading = {
  fontSize: '24px',
  fontWeight: 'bold' as const,
  color: '#1f2937',
  margin: '0 0 24px',
};

const paragraph = {
  fontSize: '14px',
  lineHeight: '24px',
  color: '#4b5563',
  margin: '0 0 16px',
};

const invoiceCard = {
  backgroundColor: '#f9fafb',
  borderRadius: '8px',
  padding: '24px',
  margin: '24px 0',
};

const overdueCard = {
  backgroundColor: '#fef2f2',
  borderRadius: '8px',
  padding: '24px',
  margin: '24px 0',
  border: '1px solid #fecaca',
};

const invoiceHeader = {
  width: '100%',
};

const invoiceLabel = {
  fontSize: '12px',
  color: '#6b7280',
  textTransform: 'uppercase' as const,
  margin: '0 0 4px',
};

const invoiceNumberStyle = {
  fontSize: '16px',
  fontWeight: '600' as const,
  color: '#1f2937',
  margin: '0',
};

const amountDue = {
  fontSize: '24px',
  fontWeight: 'bold' as const,
  color: '#059669',
  margin: '0',
};

const amountOverdue = {
  fontSize: '24px',
  fontWeight: 'bold' as const,
  color: '#dc2626',
  margin: '0',
};

const divider = {
  borderColor: '#e5e7eb',
  margin: '16px 0',
};

const detailsTable = {
  width: '100%',
};

const labelCell = {
  fontSize: '14px',
  color: '#6b7280',
  padding: '4px 0',
  width: '120px',
};

const valueCell = {
  fontSize: '14px',
  color: '#1f2937',
  fontWeight: '500' as const,
  padding: '4px 0',
};

const overdueValueCell = {
  fontSize: '14px',
  color: '#dc2626',
  fontWeight: '600' as const,
  padding: '4px 0',
};

const buttonSection = {
  textAlign: 'center' as const,
  margin: '32px 0',
};

const primaryButton = {
  backgroundColor: '#059669',
  borderRadius: '6px',
  color: '#ffffff',
  fontSize: '16px',
  fontWeight: '600' as const,
  padding: '14px 32px',
  textDecoration: 'none',
};

const contactText = {
  fontSize: '13px',
  color: '#6b7280',
  textAlign: 'center' as const,
  margin: '0',
};
