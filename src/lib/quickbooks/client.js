/**
 * QuickBooks Online API Client
 */

const QBO_BASE_URL = 'https://quickbooks.api.intuit.com';
const QBO_SANDBOX_URL = 'https://sandbox-quickbooks.api.intuit.com';

export class QuickBooksClient {
  constructor({ accessToken, realmId, environment = 'sandbox' }) {
    this.accessToken = accessToken;
    this.realmId = realmId;
    this.baseUrl = environment === 'production' ? QBO_BASE_URL : QBO_SANDBOX_URL;
  }

  async request(endpoint, options = {}) {
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
  
  async createCustomer(customer) {
    const qboCustomer = {
      DisplayName: customer.name || `${customer.firstName} ${customer.lastName}`.trim(),
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
    Object.keys(qboCustomer).forEach(key => 
      qboCustomer[key] === undefined && delete qboCustomer[key]
    );

    const result = await this.request('/customer', {
      method: 'POST',
      body: JSON.stringify(qboCustomer),
    });

    return result.Customer;
  }

  async findCustomerByName(displayName) {
    const query = `SELECT * FROM Customer WHERE DisplayName = '${displayName.replace(/'/g, "\\'")}'`;
    const result = await this.request(`/query?query=${encodeURIComponent(query)}`);
    return result.QueryResponse?.Customer?.[0] || null;
  }

  async findCustomerByEmail(email) {
    const query = `SELECT * FROM Customer WHERE PrimaryEmailAddr = '${email}'`;
    const result = await this.request(`/query?query=${encodeURIComponent(query)}`);
    return result.QueryResponse?.Customer?.[0] || null;
  }

  async getCustomer(id) {
    const result = await this.request(`/customer/${id}`);
    return result.Customer;
  }

  async updateCustomer(customer) {
    const result = await this.request('/customer', {
      method: 'POST',
      body: JSON.stringify(customer),
    });
    return result.Customer;
  }

  // ============= INVOICES =============

  async createInvoice(invoice) {
    const qboInvoice = {
      CustomerRef: { value: invoice.customerId },
      Line: invoice.lineItems.map((item, index) => ({
        Id: String(index + 1),
        LineNum: index + 1,
        Amount: item.amount,
        DetailType: 'SalesItemLineDetail',
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

    const result = await this.request('/invoice', {
      method: 'POST',
      body: JSON.stringify(qboInvoice),
    });

    return result.Invoice;
  }

  async getInvoice(id) {
    const result = await this.request(`/invoice/${id}`);
    return result.Invoice;
  }

  // ============= PAYMENTS =============

  async createPayment(payment) {
    const qboPayment = {
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

    const result = await this.request('/payment', {
      method: 'POST',
      body: JSON.stringify(qboPayment),
    });

    return result.Payment;
  }

  // ============= ITEMS (Products/Services) =============

  async createItem(item) {
    const qboItem = {
      Name: item.name,
      Description: item.description,
      Type: item.type || 'Service',
      IncomeAccountRef: { value: item.incomeAccountId || '1' }, // Default income account
      UnitPrice: item.price,
    };

    const result = await this.request('/item', {
      method: 'POST',
      body: JSON.stringify(qboItem),
    });

    return result.Item;
  }

  async findItemByName(name) {
    const query = `SELECT * FROM Item WHERE Name = '${name.replace(/'/g, "\\'")}'`;
    const result = await this.request(`/query?query=${encodeURIComponent(query)}`);
    return result.QueryResponse?.Item?.[0] || null;
  }

  // ============= ACCOUNTS =============

  async getAccounts() {
    const query = 'SELECT * FROM Account';
    const result = await this.request(`/query?query=${encodeURIComponent(query)}`);
    return result.QueryResponse?.Account || [];
  }

  // ============= COMPANY INFO =============

  async getCompanyInfo() {
    const result = await this.request(`/companyinfo/${this.realmId}`);
    return result.CompanyInfo;
  }
}

export default QuickBooksClient;
