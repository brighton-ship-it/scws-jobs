/**
 * QuickBooks Online API Client
 */

const QBO_BASE_URL = 'https://quickbooks.api.intuit.com';
const QBO_SANDBOX_URL = 'https://sandbox-quickbooks.api.intuit.com';

export interface QBOClientConfig {
  accessToken: string;
  realmId: string;
  environment?: 'sandbox' | 'production';
}

export interface QBOCustomer {
  Id?: string;
  SyncToken?: string;
  DisplayName: string;
  GivenName?: string;
  FamilyName?: string;
  CompanyName?: string;
  PrimaryPhone?: { FreeFormNumber: string };
  PrimaryEmailAddr?: { Address: string };
  BillAddr?: {
    Line1?: string;
    City?: string;
    CountrySubDivisionCode?: string;
    PostalCode?: string;
  };
}

export interface QBOInvoiceLine {
  Id?: string;
  LineNum?: number;
  Amount: number;
  DetailType: 'SalesItemLineDetail';
  SalesItemLineDetail: {
    ItemRef?: { value: string };
    Qty?: number;
    UnitPrice?: number;
  };
  Description?: string;
}

export interface QBOInvoice {
  Id?: string;
  SyncToken?: string;
  CustomerRef: { value: string };
  Line: QBOInvoiceLine[];
  DueDate?: string;
  DocNumber?: string;
  PrivateNote?: string;
  BillEmail?: { Address: string };
  TxnDate?: string;
  TotalAmt?: number;
}

export interface QBOPayment {
  Id?: string;
  SyncToken?: string;
  CustomerRef: { value: string };
  TotalAmt: number;
  Line?: Array<{
    Amount: number;
    LinkedTxn: Array<{
      TxnId: string;
      TxnType: 'Invoice';
    }>;
  }>;
  PaymentMethodRef?: { value: string };
  PrivateNote?: string;
  TxnDate?: string;
}

export interface QBOCompanyInfo {
  CompanyName: string;
  Country: string;
  CompanyAddr?: {
    City?: string;
    Line1?: string;
    PostalCode?: string;
    CountrySubDivisionCode?: string;
  };
}

export interface CustomerInput {
  name: string;
  firstName?: string;
  lastName?: string;
  companyName?: string;
  phone?: string;
  email?: string;
  address?: {
    street1?: string;
    city?: string;
    state?: string;
    zip?: string;
  };
}

export interface InvoiceInput {
  customerId: string;
  lineItems: Array<{
    description: string;
    amount: number;
    quantity?: number;
    unitPrice?: number;
    itemId?: string;
  }>;
  dueDate?: string;
  invoiceNumber?: string;
  notes?: string;
  email?: string;
}

export interface PaymentInput {
  customerId: string;
  amount: number;
  invoiceId?: string;
  paymentMethodId?: string;
  notes?: string;
}

export class QuickBooksClient {
  private accessToken: string;
  private realmId: string;
  private baseUrl: string;

  constructor({ accessToken, realmId, environment = 'sandbox' }: QBOClientConfig) {
    this.accessToken = accessToken;
    this.realmId = realmId;
    this.baseUrl = environment === 'production' ? QBO_BASE_URL : QBO_SANDBOX_URL;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}/v3/company/${this.realmId}${endpoint}`;
    
    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('QuickBooks API Error:', error);
      throw new Error(`QuickBooks API Error: ${response.status} - ${error}`);
    }

    return response.json();
  }

  // ============= CUSTOMERS =============
  
  async createCustomer(customer: CustomerInput): Promise<QBOCustomer> {
    const qboCustomer: Partial<QBOCustomer> = {
      DisplayName: customer.name || `${customer.firstName || ''} ${customer.lastName || ''}`.trim(),
      GivenName: customer.firstName,
      FamilyName: customer.lastName,
      CompanyName: customer.companyName,
      PrimaryPhone: customer.phone ? { FreeFormNumber: customer.phone } : undefined,
      PrimaryEmailAddr: customer.email ? { Address: customer.email } : undefined,
      BillAddr: customer.address ? {
        Line1: customer.address.street1,
        City: customer.address.city,
        CountrySubDivisionCode: customer.address.state || 'CA',
        PostalCode: customer.address.zip,
      } : undefined,
    };

    // Remove undefined fields
    Object.keys(qboCustomer).forEach(key => {
      if (qboCustomer[key as keyof typeof qboCustomer] === undefined) {
        delete qboCustomer[key as keyof typeof qboCustomer];
      }
    });

    const result = await this.request<{ Customer: QBOCustomer }>('/customer', {
      method: 'POST',
      body: JSON.stringify(qboCustomer),
    });

    return result.Customer;
  }

  async findCustomerByName(displayName: string): Promise<QBOCustomer | null> {
    const query = `SELECT * FROM Customer WHERE DisplayName = '${displayName.replace(/'/g, "\\'")}'`;
    const result = await this.request<{ QueryResponse?: { Customer?: QBOCustomer[] } }>(
      `/query?query=${encodeURIComponent(query)}`
    );
    return result.QueryResponse?.Customer?.[0] || null;
  }

  async findCustomerByEmail(email: string): Promise<QBOCustomer | null> {
    const query = `SELECT * FROM Customer WHERE PrimaryEmailAddr = '${email}'`;
    const result = await this.request<{ QueryResponse?: { Customer?: QBOCustomer[] } }>(
      `/query?query=${encodeURIComponent(query)}`
    );
    return result.QueryResponse?.Customer?.[0] || null;
  }

  async getCustomer(id: string): Promise<QBOCustomer> {
    const result = await this.request<{ Customer: QBOCustomer }>(`/customer/${id}`);
    return result.Customer;
  }

  async updateCustomer(customer: QBOCustomer): Promise<QBOCustomer> {
    const result = await this.request<{ Customer: QBOCustomer }>('/customer', {
      method: 'POST',
      body: JSON.stringify(customer),
    });
    return result.Customer;
  }

  // ============= INVOICES =============

  async createInvoice(invoice: InvoiceInput): Promise<QBOInvoice> {
    const qboInvoice: QBOInvoice = {
      CustomerRef: { value: invoice.customerId },
      Line: invoice.lineItems.map((item, index) => ({
        Id: String(index + 1),
        LineNum: index + 1,
        Amount: item.amount,
        DetailType: 'SalesItemLineDetail' as const,
        SalesItemLineDetail: {
          ItemRef: item.itemId ? { value: item.itemId } : undefined,
          Qty: item.quantity || 1,
          UnitPrice: item.unitPrice || item.amount,
        },
        Description: item.description,
      })),
      DueDate: invoice.dueDate,
      DocNumber: invoice.invoiceNumber,
      PrivateNote: invoice.notes,
      BillEmail: invoice.email ? { Address: invoice.email } : undefined,
    };

    const result = await this.request<{ Invoice: QBOInvoice }>('/invoice', {
      method: 'POST',
      body: JSON.stringify(qboInvoice),
    });

    return result.Invoice;
  }

  async getInvoice(id: string): Promise<QBOInvoice> {
    const result = await this.request<{ Invoice: QBOInvoice }>(`/invoice/${id}`);
    return result.Invoice;
  }

  // ============= PAYMENTS =============

  async createPayment(payment: PaymentInput): Promise<QBOPayment> {
    const qboPayment: Partial<QBOPayment> = {
      CustomerRef: { value: payment.customerId },
      TotalAmt: payment.amount,
      Line: payment.invoiceId ? [{
        Amount: payment.amount,
        LinkedTxn: [{
          TxnId: payment.invoiceId,
          TxnType: 'Invoice',
        }],
      }] : undefined,
      PaymentMethodRef: payment.paymentMethodId ? { value: payment.paymentMethodId } : undefined,
      PrivateNote: payment.notes,
    };

    const result = await this.request<{ Payment: QBOPayment }>('/payment', {
      method: 'POST',
      body: JSON.stringify(qboPayment),
    });

    return result.Payment;
  }

  // ============= COMPANY INFO =============

  async getCompanyInfo(): Promise<QBOCompanyInfo> {
    const result = await this.request<{ CompanyInfo: QBOCompanyInfo }>(`/companyinfo/${this.realmId}`);
    return result.CompanyInfo;
  }
}

export default QuickBooksClient;
