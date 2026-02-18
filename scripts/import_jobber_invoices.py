#!/usr/bin/env python3
"""
Import Jobber invoices into SCWS CRM (Supabase)
Only imports PAID invoices with balance = $0 and total > $0
"""

import csv
import psycopg2
from datetime import datetime
import re
import sys

# Supabase Postgres connection
DB_CONFIG = {
    'host': 'db.htzsnpqrrrdfleldgybn.supabase.co',
    'port': 5432,
    'database': 'postgres',
    'user': 'postgres',
    'password': 'Scwellservice123!'
}

def parse_date(date_str):
    """Parse date like 'Feb 16, 2026' to date object"""
    if not date_str or date_str == '-':
        return None
    try:
        return datetime.strptime(date_str, '%b %d, %Y').date()
    except:
        return None

def clean_phone(phone):
    """Normalize phone number"""
    if not phone:
        return None
    digits = re.sub(r'\D', '', phone)
    if len(digits) == 10:
        return f"({digits[:3]}) {digits[3:6]}-{digits[6:]}"
    elif len(digits) == 11 and digits[0] == '1':
        return f"({digits[1:4]}) {digits[4:7]}-{digits[7:]}"
    return phone

def main():
    csv_file = sys.argv[1] if len(sys.argv) > 1 else '/Users/jarvis/.openclaw/media/inbound/e57f1499-25b4-4878-ae0a-bbb8b6f05d6c.csv'
    
    # Read CSV
    print(f"Reading {csv_file}...")
    with open(csv_file, 'r') as f:
        reader = csv.DictReader(f)
        invoices = list(reader)
    
    # Filter: Paid, balance = 0, total > 0
    paid_invoices = [
        inv for inv in invoices 
        if inv['Status'] == 'Paid' 
        and float(inv['Balance ($)']) == 0.0 
        and float(inv['Total ($)']) > 0
    ]
    
    print(f"Found {len(paid_invoices)} paid invoices to import", flush=True)
    
    # Connect to database
    print("Connecting to Supabase...", flush=True)
    conn = psycopg2.connect(**DB_CONFIG)
    cur = conn.cursor()
    
    # Get max invoice number to avoid conflicts
    cur.execute("SELECT COALESCE(MAX(invoice_number), 0) FROM invoices")
    max_inv_num = cur.fetchone()[0]
    print(f"Current max invoice number in CRM: {max_inv_num}", flush=True)
    
    # Track stats
    customers_created = 0
    customers_found = 0
    properties_created = 0
    invoices_created = 0
    invoices_skipped = 0
    
    try:
        for idx, inv in enumerate(paid_invoices):
            jobber_inv_num = int(inv['Invoice #'])
            
            # Check if this Jobber invoice already imported (check notes field or invoice number)
            cur.execute(
                "SELECT id FROM invoices WHERE internal_notes LIKE %s OR invoice_number = %s",
                (f'%Jobber #{jobber_inv_num}%', jobber_inv_num)
            )
            if cur.fetchone():
                invoices_skipped += 1
                continue
            
            # Get or create customer
            email = inv['Client email'].strip().lower() if inv['Client email'] else None
            phone = clean_phone(inv['Client phone'])
            name = inv['Client name'].strip()
            lead_source = inv['Lead source'].strip() if inv['Lead source'] else None
            
            # Try to find existing customer by email or phone+name
            customer_id = None
            if email:
                cur.execute("SELECT id FROM customers WHERE LOWER(email) = %s", (email,))
                result = cur.fetchone()
                if result:
                    customer_id = result[0]
                    customers_found += 1
            
            if not customer_id and phone and name:
                cur.execute(
                    "SELECT id FROM customers WHERE phone = %s AND LOWER(name) = LOWER(%s)",
                    (phone, name)
                )
                result = cur.fetchone()
                if result:
                    customer_id = result[0]
                    customers_found += 1
            
            # Create customer if not found
            if not customer_id:
                billing_street = inv['Billing street'].strip() if inv['Billing street'] else None
                billing_city = inv['Billing city'].strip() if inv['Billing city'] else None
                billing_state = inv['Billing province'].strip() if inv['Billing province'] else None
                billing_zip = inv['Billing ZIP'].strip() if inv['Billing ZIP'] else None
                
                billing_address = ', '.join(filter(None, [billing_street, billing_city, billing_state, billing_zip]))
                
                cur.execute("""
                    INSERT INTO customers (
                        name, email, phone, billing_address, 
                        billing_city, billing_state, billing_zip,
                        lead_source, notes
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    RETURNING id
                """, (
                    name, 
                    email, 
                    phone, 
                    billing_address or None,
                    billing_city,
                    billing_state,
                    billing_zip,
                    lead_source,
                    "Imported from Jobber"
                ))
                
                customer_id = cur.fetchone()[0]
                customers_created += 1
            
            # Create property if service address provided
            service_street = inv['Service street'].strip() if inv['Service street'] else None
            if service_street and service_street not in ['', '-'] and not service_street.startswith('('):
                # Check if property exists for this customer at this address
                cur.execute("""
                    SELECT id FROM properties 
                    WHERE customer_id = %s AND LOWER(address) = LOWER(%s)
                """, (customer_id, service_street))
                result = cur.fetchone()
                
                if not result:
                    cur.execute("""
                        INSERT INTO properties (customer_id, address, city, zip)
                        VALUES (%s, %s, %s, %s)
                    """, (
                        customer_id,
                        service_street,
                        inv['Service city'] or None,
                        inv['Service ZIP'] or None
                    ))
                    properties_created += 1
            
            # Create invoice
            # Check if this invoice number is already taken
            cur.execute("SELECT id FROM invoices WHERE invoice_number = %s", (jobber_inv_num,))
            if cur.fetchone():
                # Number is taken, use next available
                max_inv_num += 1
                new_inv_num = max_inv_num
            else:
                new_inv_num = jobber_inv_num
                if new_inv_num > max_inv_num:
                    max_inv_num = new_inv_num
            
            subtotal = float(inv['Pre-tax total ($)'])
            tax_amount = float(inv['Tax amount ($)'])
            total = float(inv['Total ($)'])
            deposit = float(inv['Deposit $']) if inv['Deposit $'] else 0
            discount = float(inv['Discount ($)']) if inv['Discount ($)'] else 0
            
            # Calculate tax rate
            tax_rate = (tax_amount / subtotal * 100) if subtotal > 0 else 0
            
            issue_date = parse_date(inv['Issued date']) or datetime.now().date()
            due_date = parse_date(inv['Due date'])
            paid_date = parse_date(inv['Marked paid date'])
            
            # Line items summary for notes
            line_items = inv['Line items']
            
            cur.execute("""
                INSERT INTO invoices (
                    invoice_number, customer_id, status,
                    issue_date, due_date, 
                    subtotal, tax_rate, tax_amount, total, amount_paid,
                    notes, internal_notes, paid_at, created_at, updated_at
                )
                VALUES (%s, %s, 'paid', %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, (
                new_inv_num,
                customer_id,
                issue_date,
                due_date,
                subtotal,
                round(tax_rate, 4),
                tax_amount,
                total,
                total,  # amount_paid = total since it's paid
                f"Subject: {inv['Subject']}" if inv['Subject'] else None,
                f"Jobber #{jobber_inv_num} | Items: {line_items[:500]}" if line_items else f"Jobber #{jobber_inv_num}",
                paid_date,
                issue_date,
                datetime.now()
            ))
            
            invoices_created += 1
            
            # Update max for next iteration
            if new_inv_num > max_inv_num:
                max_inv_num = new_inv_num
            
            # Progress update every 50
            if (idx + 1) % 50 == 0:
                print(f"  Processed {idx + 1}/{len(paid_invoices)} - {invoices_created} created, {invoices_skipped} skipped", flush=True)
                conn.commit()
        
        conn.commit()
        
    except Exception as e:
        conn.rollback()
        print(f"ERROR: {e}")
        import traceback
        traceback.print_exc()
        raise
    finally:
        cur.close()
        conn.close()
    
    print()
    print("=== IMPORT COMPLETE ===")
    print(f"Customers created: {customers_created}")
    print(f"Customers found (existing): {customers_found}")
    print(f"Properties created: {properties_created}")
    print(f"Invoices created: {invoices_created}")
    print(f"Invoices skipped (already imported): {invoices_skipped}")
    print(f"Total: {customers_created + customers_found} customers, {invoices_created} invoices")

if __name__ == '__main__':
    main()
