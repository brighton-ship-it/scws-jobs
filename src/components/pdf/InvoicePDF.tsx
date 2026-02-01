'use client';

import { Document, Page, Text, View, StyleSheet, Font } from '@react-pdf/renderer';
import type { InvoiceWithDetails } from '@/types/database';
import { format } from 'date-fns';

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontSize: 10,
    fontFamily: 'Helvetica',
    color: '#1f2937',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 30,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#1f2937',
  },
  invoiceNumber: {
    fontSize: 14,
    color: '#6b7280',
  },
  companyName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#2563eb',
    textAlign: 'right',
  },
  companyInfo: {
    fontSize: 9,
    color: '#6b7280',
    textAlign: 'right',
    marginTop: 4,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 9,
    fontWeight: 'bold',
    color: '#6b7280',
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  column: {
    flex: 1,
  },
  customerName: {
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  customerInfo: {
    fontSize: 10,
    color: '#4b5563',
    lineHeight: 1.4,
  },
  dateLabel: {
    fontSize: 9,
    color: '#6b7280',
  },
  dateValue: {
    fontSize: 11,
    fontWeight: 'bold',
    marginTop: 2,
  },
  dateValueDanger: {
    fontSize: 11,
    fontWeight: 'bold',
    marginTop: 2,
    color: '#dc2626',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    marginTop: 8,
    alignSelf: 'flex-start',
  },
  statusPaid: {
    backgroundColor: '#dcfce7',
  },
  statusOverdue: {
    backgroundColor: '#fee2e2',
  },
  statusSent: {
    backgroundColor: '#dbeafe',
  },
  statusDraft: {
    backgroundColor: '#f3f4f6',
  },
  statusText: {
    fontSize: 10,
    fontWeight: 'bold',
    textTransform: 'uppercase',
  },
  statusTextPaid: {
    color: '#16a34a',
  },
  statusTextOverdue: {
    color: '#dc2626',
  },
  statusTextSent: {
    color: '#2563eb',
  },
  statusTextDraft: {
    color: '#6b7280',
  },
  table: {
    marginTop: 20,
  },
  tableHeader: {
    flexDirection: 'row',
    borderBottomWidth: 2,
    borderBottomColor: '#e5e7eb',
    paddingBottom: 8,
    marginBottom: 8,
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
    paddingVertical: 8,
  },
  colDescription: {
    flex: 4,
  },
  colQty: {
    flex: 1,
    textAlign: 'right',
  },
  colPrice: {
    flex: 1.5,
    textAlign: 'right',
  },
  colTotal: {
    flex: 1.5,
    textAlign: 'right',
  },
  headerText: {
    fontSize: 9,
    fontWeight: 'bold',
    color: '#6b7280',
    textTransform: 'uppercase',
  },
  itemDescription: {
    fontSize: 10,
    color: '#1f2937',
  },
  itemType: {
    fontSize: 8,
    color: '#9ca3af',
    textTransform: 'capitalize',
    marginTop: 2,
  },
  itemText: {
    fontSize: 10,
    color: '#4b5563',
  },
  itemTotal: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#1f2937',
  },
  totalsSection: {
    marginTop: 20,
    alignItems: 'flex-end',
  },
  totalsBox: {
    width: 220,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  totalLabel: {
    fontSize: 10,
    color: '#6b7280',
  },
  totalValue: {
    fontSize: 10,
    fontWeight: 'bold',
  },
  grandTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    marginTop: 4,
  },
  grandTotalLabel: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#1f2937',
  },
  grandTotalValue: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#1f2937',
  },
  balanceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    backgroundColor: '#fef3c7',
    marginTop: 8,
    marginHorizontal: -8,
    paddingHorizontal: 8,
    borderRadius: 4,
  },
  balanceLabel: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#92400e',
  },
  balanceValue: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#92400e',
  },
  paidRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    backgroundColor: '#dcfce7',
    marginTop: 8,
    marginHorizontal: -8,
    paddingHorizontal: 8,
    borderRadius: 4,
  },
  paidLabel: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#16a34a',
  },
  paidValue: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#16a34a',
  },
  notes: {
    marginTop: 30,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
  },
  notesText: {
    fontSize: 10,
    color: '#4b5563',
    lineHeight: 1.5,
  },
  paymentsSection: {
    marginTop: 30,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
  },
  paymentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  paymentInfo: {
    fontSize: 10,
    color: '#4b5563',
  },
  paymentAmount: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#16a34a',
  },
  footer: {
    position: 'absolute',
    bottom: 40,
    left: 40,
    right: 40,
    textAlign: 'center',
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
  },
  footerText: {
    fontSize: 9,
    color: '#6b7280',
  },
  footerSmall: {
    fontSize: 8,
    color: '#9ca3af',
    marginTop: 4,
  },
});

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
};

interface InvoicePDFProps {
  invoice: InvoiceWithDetails;
  companyInfo?: {
    name: string;
    subtitle: string;
    address: string;
    phone: string;
    email: string;
  };
}

export function InvoicePDF({ invoice, companyInfo }: InvoicePDFProps) {
  const company = companyInfo || {
    name: 'SCWS',
    subtitle: 'So Cal Well Service',
    address: '123 Main Street, Palm Desert, CA 92260',
    phone: '(760) 555-0100',
    email: 'info@scwellservice.com',
  };

  const balanceDue = invoice.total - invoice.amount_paid;
  const isOverdue = invoice.due_date && new Date(invoice.due_date) < new Date() && invoice.status !== 'paid';

  const getStatusStyle = () => {
    switch (invoice.status) {
      case 'paid':
        return { badge: styles.statusPaid, text: styles.statusTextPaid };
      case 'overdue':
        return { badge: styles.statusOverdue, text: styles.statusTextOverdue };
      case 'sent':
      case 'viewed':
        return { badge: styles.statusSent, text: styles.statusTextSent };
      default:
        return { badge: styles.statusDraft, text: styles.statusTextDraft };
    }
  };

  const statusStyle = getStatusStyle();

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>INVOICE</Text>
            <Text style={styles.invoiceNumber}>#{invoice.invoice_number}</Text>
            <View style={[styles.statusBadge, statusStyle.badge]}>
              <Text style={[styles.statusText, statusStyle.text]}>
                {invoice.status.toUpperCase()}
              </Text>
            </View>
          </View>
          <View>
            <Text style={styles.companyName}>{company.name}</Text>
            <Text style={styles.companyInfo}>{company.subtitle}</Text>
            <Text style={styles.companyInfo}>{company.address}</Text>
            <Text style={styles.companyInfo}>{company.phone}</Text>
          </View>
        </View>

        {/* Customer & Dates */}
        <View style={styles.row}>
          <View style={styles.column}>
            <Text style={styles.sectionTitle}>Bill To</Text>
            <Text style={styles.customerName}>{invoice.customer.name}</Text>
            {invoice.customer.billing_address && (
              <Text style={styles.customerInfo}>{invoice.customer.billing_address}</Text>
            )}
            {invoice.customer.email && (
              <Text style={styles.customerInfo}>{invoice.customer.email}</Text>
            )}
            {invoice.customer.phone && (
              <Text style={styles.customerInfo}>{invoice.customer.phone}</Text>
            )}
          </View>
          <View style={{ width: 150, alignItems: 'flex-end' }}>
            <View style={{ marginBottom: 12 }}>
              <Text style={styles.dateLabel}>Invoice Date</Text>
              <Text style={styles.dateValue}>{format(new Date(invoice.issue_date), 'MMMM d, yyyy')}</Text>
            </View>
            {invoice.due_date && (
              <View>
                <Text style={styles.dateLabel}>Due Date</Text>
                <Text style={isOverdue ? styles.dateValueDanger : styles.dateValue}>
                  {format(new Date(invoice.due_date), 'MMMM d, yyyy')}
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* Line Items Table */}
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.headerText, styles.colDescription]}>Description</Text>
            <Text style={[styles.headerText, styles.colQty]}>Qty</Text>
            <Text style={[styles.headerText, styles.colPrice]}>Unit Price</Text>
            <Text style={[styles.headerText, styles.colTotal]}>Total</Text>
          </View>
          {invoice.items.map((item) => (
            <View key={item.id} style={styles.tableRow}>
              <View style={styles.colDescription}>
                <Text style={styles.itemDescription}>{item.description}</Text>
                {item.item_type && <Text style={styles.itemType}>{item.item_type}</Text>}
              </View>
              <Text style={[styles.itemText, styles.colQty]}>{item.quantity}</Text>
              <Text style={[styles.itemText, styles.colPrice]}>{formatCurrency(item.unit_price)}</Text>
              <Text style={[styles.itemTotal, styles.colTotal]}>{formatCurrency(item.total)}</Text>
            </View>
          ))}
        </View>

        {/* Totals */}
        <View style={styles.totalsSection}>
          <View style={styles.totalsBox}>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Subtotal</Text>
              <Text style={styles.totalValue}>{formatCurrency(invoice.subtotal)}</Text>
            </View>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Tax ({invoice.tax_rate}%)</Text>
              <Text style={styles.totalValue}>{formatCurrency(invoice.tax_amount)}</Text>
            </View>
            <View style={styles.grandTotalRow}>
              <Text style={styles.grandTotalLabel}>Total</Text>
              <Text style={styles.grandTotalValue}>{formatCurrency(invoice.total)}</Text>
            </View>
            {invoice.amount_paid > 0 && (
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Amount Paid</Text>
                <Text style={[styles.totalValue, { color: '#16a34a' }]}>
                  -{formatCurrency(invoice.amount_paid)}
                </Text>
              </View>
            )}
            {invoice.status === 'paid' ? (
              <View style={styles.paidRow}>
                <Text style={styles.paidLabel}>PAID IN FULL</Text>
                <Text style={styles.paidValue}>{formatCurrency(0)}</Text>
              </View>
            ) : balanceDue > 0 && (
              <View style={styles.balanceRow}>
                <Text style={styles.balanceLabel}>Balance Due</Text>
                <Text style={styles.balanceValue}>{formatCurrency(balanceDue)}</Text>
              </View>
            )}
          </View>
        </View>

        {/* Payments History */}
        {invoice.payments && invoice.payments.length > 0 && (
          <View style={styles.paymentsSection}>
            <Text style={styles.sectionTitle}>Payment History</Text>
            {invoice.payments.map((payment) => (
              <View key={payment.id} style={styles.paymentRow}>
                <Text style={styles.paymentInfo}>
                  {format(new Date(payment.payment_date), 'MMM d, yyyy')} - {payment.payment_method || 'Payment'}
                  {payment.reference_number && ` (${payment.reference_number})`}
                </Text>
                <Text style={styles.paymentAmount}>{formatCurrency(payment.amount)}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Notes */}
        {invoice.notes && (
          <View style={styles.notes}>
            <Text style={styles.sectionTitle}>Notes</Text>
            <Text style={styles.notesText}>{invoice.notes}</Text>
          </View>
        )}

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>Thank you for your business!</Text>
          <Text style={styles.footerSmall}>
            Questions? Call us at {company.phone} or email {company.email}
          </Text>
        </View>
      </Page>
    </Document>
  );
}
