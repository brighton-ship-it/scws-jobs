import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

console.log('URL:', supabaseUrl ? 'Found' : 'Missing');

const supabase = createClient(supabaseUrl, supabaseKey);

const team = [
  { email: 'brighton@scwellservice.com', name: 'Brighton Scala', role: 'admin', phone: '(760) 440-8520' },
  { email: 'bschroeder@scwellservice.com', name: 'Brian Schroeder', role: 'admin', phone: '(760) 440-8520' },
  { email: 'lizbeth@scwellservice.com', name: 'Lizbeth Nunez', role: 'office', phone: '(760) 440-8520' },
  { email: 'roger@scwellservice.com', name: 'Roger Scala', role: 'admin', phone: '(760) 440-8520' },
  { email: 'shanicey@scwellservice.com', name: 'Shanicey Sego', role: 'admin', phone: '(760) 440-8520' },
  { email: 'travis@scwellservice.com', name: 'Travis C Sego', role: 'admin', phone: '(760) 440-8520' },
  { email: 'austin@scwellservice.com', name: 'Austin W Tipton', role: 'field', phone: '(760) 440-8520' },
  { email: 'brian@scwellservice.com', name: 'Brian Eads', role: 'field', phone: '(760) 440-8520' },
  { email: 'christopher@scwellservice.com', name: 'Chris Glass', role: 'field', phone: '(760) 440-8520' },
  { email: 'cowin@scwellservice.com', name: 'Cowin', role: 'field', phone: '(760) 440-8520' },
  { email: 'dakota@scwellservice.com', name: 'Dakota Cole', role: 'field', phone: '(760) 440-8520' },
  { email: 'damian@scwellservice.com', name: 'Damian Famania', role: 'field', phone: '(760) 440-8520' },
  { email: 'dylan@scwellservice.com', name: 'Dylan J Rabas', role: 'field', phone: '(760) 440-8520' },
  { email: 'hazemtarbell@gmail.com', name: 'Haze Tarbell', role: 'field', phone: '(760) 440-8520' },
  { email: 'jeff@scwellservice.com', name: 'Jeff Gezewski', role: 'field', phone: '(760) 440-8520' },
  { email: 'marshall@scwellservice.com', name: 'Marshall Car', role: 'field', phone: '(760) 440-8520' },
  { email: 'sergio@scwellservice.com', name: 'Sergio Valdovinos Mendez', role: 'field', phone: '(760) 440-8520' },
];

async function seed() {
  for (const member of team) {
    const { data, error } = await supabase
      .from('users')
      .upsert(member, { onConflict: 'email' })
      .select();
    
    if (error) {
      console.log(`❌ ${member.name}: ${error.message}`);
    } else {
      console.log(`✅ ${member.name}`);
    }
  }
}

seed();
