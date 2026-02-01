import {
  Button,
  Heading,
  Hr,
  Section,
  Text,
} from '@react-email/components';
import * as React from 'react';
import { BaseLayout } from './base-layout';

interface JobReminderEmailProps {
  recipientName: string;
  jobType: string;
  customerName: string;
  propertyAddress: string;
  scheduledDate: string;
  scheduledTime: string;
  accessNotes?: string;
  jobUrl: string;
}

export function JobReminderEmail({
  recipientName = 'Mike',
  jobType = 'Pump Inspection',
  customerName = 'Johnson Ranch',
  propertyAddress = '45678 Desert View Rd, Borrego Springs, CA',
  scheduledDate = 'Tomorrow',
  scheduledTime = '9:00 AM',
  accessNotes = 'Gate code: 1234. Main house well is behind the barn.',
  jobUrl = 'https://app.scwellservice.com/jobs/1',
}: JobReminderEmailProps) {
  return (
    <BaseLayout preview={`Reminder: ${jobType} ${scheduledDate} at ${scheduledTime}`}>
      <Section style={alertBanner}>
        <Text style={alertText}>⏰ Job Reminder</Text>
      </Section>

      <Heading style={heading}>Upcoming Job</Heading>
      
      <Text style={paragraph}>
        Hi {recipientName},
      </Text>
      
      <Text style={paragraph}>
        This is a reminder about your upcoming job:
      </Text>

      <Section style={jobCard}>
        <Text style={jobTypeStyle}>{jobType}</Text>
        <Text style={customerStyle}>{customerName}</Text>
        <Hr style={divider} />
        
        <table style={detailsTable}>
          <tbody>
            <tr>
              <td style={labelCell}>📍 Location</td>
              <td style={valueCell}>{propertyAddress}</td>
            </tr>
            <tr>
              <td style={labelCell}>📅 When</td>
              <td style={valueCell}>{scheduledDate} at {scheduledTime}</td>
            </tr>
          </tbody>
        </table>

        {accessNotes && (
          <>
            <Hr style={divider} />
            <Section style={accessBox}>
              <Text style={accessLabel}>🔑 Access Notes</Text>
              <Text style={accessText}>{accessNotes}</Text>
            </Section>
          </>
        )}
      </Section>

      <Section style={buttonSection}>
        <Button style={button} href={jobUrl}>
          View Job Details
        </Button>
      </Section>

      <Text style={paragraph}>
        Need to reschedule? Please contact the office as soon as possible.
      </Text>
    </BaseLayout>
  );
}

export default JobReminderEmail;

const alertBanner = {
  backgroundColor: '#fef3c7',
  borderRadius: '8px',
  padding: '12px 16px',
  marginBottom: '24px',
};

const alertText = {
  fontSize: '14px',
  fontWeight: '600' as const,
  color: '#92400e',
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

const jobCard = {
  backgroundColor: '#f9fafb',
  borderRadius: '8px',
  padding: '24px',
  margin: '24px 0',
};

const jobTypeStyle = {
  fontSize: '20px',
  fontWeight: 'bold' as const,
  color: '#1f2937',
  margin: '0 0 4px',
};

const customerStyle = {
  fontSize: '16px',
  color: '#6b7280',
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

const accessBox = {
  backgroundColor: '#dbeafe',
  borderRadius: '6px',
  padding: '12px',
};

const accessLabel = {
  fontSize: '12px',
  fontWeight: '600' as const,
  color: '#1e40af',
  margin: '0 0 4px',
};

const accessText = {
  fontSize: '14px',
  color: '#1e40af',
  margin: '0',
};

const buttonSection = {
  textAlign: 'center' as const,
  margin: '32px 0',
};

const button = {
  backgroundColor: '#1e40af',
  borderRadius: '6px',
  color: '#ffffff',
  fontSize: '14px',
  fontWeight: '600' as const,
  padding: '12px 24px',
  textDecoration: 'none',
};
