'use client';

import { Document, Page, Text, View, StyleSheet, Font } from '@react-pdf/renderer';
import type { QuoteWithDetails } from '@/types/database';
import { format } from 'date-fns';

// Register fonts (using default system fonts for simplicity)
Font.register({
  family: 'Helvetica',
  fonts: [
    { src: 'Helvetica' },
    { src: 'Helvetica-Bold', fontWeight: 'bold' },
  ],
});

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
  quoteNumber: {
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
    width: 200,
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

interface QuotePDFProps {
  quote: QuoteWithDetails;
  companyInfo?: {
    name: string;
    subtitle: string;
    address: string;
    phone: string;
    email: string;
  };
}

export function QuotePDF({ quote, companyInfo }: QuotePDFProps) {
  const company = companyInfo || {
    name: 'SCWS',
    subtitle: 'So Cal Well Service',
    address: '123 Main Street, Palm Desert, CA 92260',
    phone: '(760) 555-0100',
    email: 'info@scwellservice.com',
  };

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>QUOTE</Text>
            <Text style={styles.quoteNumber}>#{quote.quote_number}</Text>
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
            <Text style={styles.customerName}>{quote.customer.name}</Text>
            {quote.customer.billing_address && (
              <Text style={styles.customerInfo}>{quote.customer.billing_address}</Text>
            )}
            {quote.customer.email && (
              <Text style={styles.customerInfo}>{quote.customer.email}</Text>
            )}
            {quote.customer.phone && (
              <Text style={styles.customerInfo}>{quote.customer.phone}</Text>
            )}
            
            {quote.property && (
              <View style={{ marginTop: 12 }}>
                <Text style={styles.sectionTitle}>Service Location</Text>
                <Text style={styles.customerInfo}>
                  {quote.property.address}
                  {quote.property.city && `, ${quote.property.city}`}
                  {quote.property.zip && ` ${quote.property.zip}`}
                </Text>
              </View>
            )}
          </View>
          <View style={{ width: 150, alignItems: 'flex-end' }}>
            <View style={{ marginBottom: 12 }}>
              <Text style={styles.dateLabel}>Quote Date</Text>
              <Text style={styles.dateValue}>{format(new Date(quote.created_at), 'MMMM d, yyyy')}</Text>
            </View>
            {quote.valid_until && (
              <View>
                <Text style={styles.dateLabel}>Valid Until</Text>
                <Text style={styles.dateValue}>{format(new Date(quote.valid_until), 'MMMM d, yyyy')}</Text>
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
          {quote.items.map((item) => (
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
              <Text style={styles.totalValue}>{formatCurrency(quote.subtotal)}</Text>
            </View>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Tax ({quote.tax_rate}%)</Text>
              <Text style={styles.totalValue}>{formatCurrency(quote.tax_amount)}</Text>
            </View>
            <View style={styles.grandTotalRow}>
              <Text style={styles.grandTotalLabel}>Total</Text>
              <Text style={styles.grandTotalValue}>{formatCurrency(quote.total)}</Text>
            </View>
          </View>
        </View>

        {/* Notes */}
        {quote.notes && (
          <View style={styles.notes}>
            <Text style={styles.sectionTitle}>Notes</Text>
            <Text style={styles.notesText}>{quote.notes}</Text>
          </View>
        )}

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>Thank you for choosing {company.subtitle}!</Text>
          <Text style={styles.footerSmall}>
            Questions? Call us at {company.phone} or email {company.email}
          </Text>
        </View>
      </Page>
    </Document>
  );
}
