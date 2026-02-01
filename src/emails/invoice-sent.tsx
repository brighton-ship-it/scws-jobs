import {
  Button,
  Heading,
  Hr,
  Section,
  Text,
} from '@react-email/components';
import * as React from 'react';
import { BaseLayout } from './base-layout';

interface InvoiceSentEmailProps {
  customerName: string;
  invoiceNumber: string;
  amount: string;
  dueDate: string;
  jobDescription: string;
  paymentUrl: string;
  pdfUrl: string;
}

export function InvoiceSentEmail({
  customerName = 'Robert',
  invoiceNumber = 'INV-2024-00001',
  amount = '$450.00',
  dueDate = 'February 15, 2025',
  jobDescription = 'Pump Inspection - 45678 Desert View Rd',
  paymentUrl = 'https://pay.scwellservice.com/inv/abc123',
  pdfUrl = 'https://app.scwellservice.com/invoices/1/pdf',
}: InvoiceSentEmailProps) {
  return (
    <BaseLayout preview={`Invoice ${invoiceNumber} for ${amount}`}>
      <Heading style={heading}>Invoice from SC Well Service</Heading>
      
      <Text style={paragraph}>
        Hi {customerName},
      </Text>
      
      <Text style={paragraph}>
        Thank you for choosing SC Well Service. Please find your invoice details below:
      </Text>

      <Section style={invoiceCard}>
        <table style={invoiceHeader}>
          <tbody>
            <tr>
              <td>
                <Text style={invoiceLabel}>Invoice Number</Text>
                <Text style={invoiceNumber}>{invoiceNumber}</Text>
              </td>
              <td style={{ textAlign: 'right' as const }}>
                <Text style={invoiceLabel}>Amount Due</Text>
                <Text style={amountDue}>{amount}</Text>
              </td>
            </tr>
          </tbody>
        </table>

        <Hr style={divider} />

        <table style={detailsTable}>
          <tbody>
            <tr>
              <td style={labelCell}>Service</td>
              <td style={valueCell}>{jobDescription}</td>
            </tr>
            <tr>
              <td style={labelCell}>Due Date</td>
              <td style={valueCell}>{dueDate}</td>
            </tr>
          </tbody>
        </table>
      </Section>

      <Section style={buttonSection}>
        <Button style={primaryButton} href={paymentUrl}>
          Pay Now
        </Button>
      </Section>

      <Text style={orText}>or</Text>

      <Section style={buttonSection}>
        <Button style={secondaryButton} href={pdfUrl}>
          Download PDF
        </Button>
      </Section>

      <Hr style={divider} />

      <Section style={paymentMethods}>
        <Text style={paymentTitle}>Payment Methods Accepted</Text>
        <Text style={paymentList}>
          💳 Credit/Debit Cards | 🏦 Bank Transfer | 📬 Check
        </Text>
      </Section>

      <Text style={paragraph}>
        If you have any questions about this invoice, please don&apos;t hesitate to contact us.
      </Text>

      <Text style={thankYou}>
        Thank you for your business!
      </Text>
    </BaseLayout>
  );
}

export default InvoiceSentEmail;

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

const invoiceHeader = {
  width: '100%',
};

const invoiceLabel = {
  fontSize: '12px',
  color: '#6b7280',
  textTransform: 'uppercase' as const,
  margin: '0 0 4px',
};

const invoiceNumber = {
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
  width: '100px',
};

const valueCell = {
  fontSize: '14px',
  color: '#1f2937',
  fontWeight: '500' as const,
  padding: '4px 0',
};

const buttonSection = {
  textAlign: 'center' as const,
  margin: '16px 0',
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

const secondaryButton = {
  backgroundColor: '#ffffff',
  border: '1px solid #d1d5db',
  borderRadius: '6px',
  color: '#374151',
  fontSize: '14px',
  fontWeight: '500' as const,
  padding: '10px 24px',
  textDecoration: 'none',
};

const orText = {
  fontSize: '12px',
  color: '#9ca3af',
  textAlign: 'center' as const,
  margin: '0',
};

const paymentMethods = {
  backgroundColor: '#f3f4f6',
  borderRadius: '6px',
  padding: '16px',
  textAlign: 'center' as const,
  margin: '24px 0',
};

const paymentTitle = {
  fontSize: '12px',
  fontWeight: '600' as const,
  color: '#6b7280',
  textTransform: 'uppercase' as const,
  margin: '0 0 8px',
};

const paymentList = {
  fontSize: '14px',
  color: '#4b5563',
  margin: '0',
};

const thankYou = {
  fontSize: '16px',
  fontWeight: '600' as const,
  color: '#1f2937',
  textAlign: 'center' as const,
  margin: '24px 0 0',
};
