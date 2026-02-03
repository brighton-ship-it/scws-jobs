'use client'

import { useState } from 'react'
import { 
  Calendar,
  Clock,
  CheckCircle,
  ChevronRight,
  Droplets,
  Wrench,
  Search,
  AlertTriangle
} from 'lucide-react'

const serviceTypes = [
  { id: 'pump_repair', name: 'Pump Repair', icon: Wrench },
  { id: 'no_water', name: 'No Water', icon: AlertTriangle, urgent: true },
  { id: 'low_pressure', name: 'Low Pressure', icon: Droplets },
  { id: 'inspection', name: 'Inspection', icon: Search },
  { id: 'other', name: 'Other', icon: Wrench },
]

const generateTimeSlots = () => {
  const slots: { date: string; display: string }[] = []
  const today = new Date()
  
  for (let i = 1; i <= 5; i++) {
    const date = new Date(today)
    date.setDate(date.getDate() + i)
    if (date.getDay() === 0) continue
    
    slots.push({
      date: date.toISOString().split('T')[0],
      display: date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    })
  }
  return slots
}

export default function EmbedBookingPage() {
  const [selectedService, setSelectedService] = useState<string | null>(null)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [selectedTime, setSelectedTime] = useState<string | null>(null)
  const [isSubmitted, setIsSubmitted] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    email: '',
    address: '',
    city: '',
    notes: '',
  })

  const availableSlots = generateTimeSlots()
  const timeSlots = ['8:00 AM', '10:00 AM', '12:00 PM', '2:00 PM', '4:00 PM']

  const handleSubmit = async () => {
    setIsSubmitting(true)
    setError(null)

    try {
      const response = await fetch('/api/booking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service_type: selectedService,
          customer_name: formData.name,
          phone: formData.phone,
          email: formData.email || null,
          address: formData.address,
          city: formData.city,
          preferred_date: selectedDate,
          preferred_time: selectedTime,
          notes: formData.notes || null,
          source: 'embed',
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to submit')
      }

      setIsSubmitted(true)
      // Notify parent window if in iframe
      if (window.parent !== window) {
        window.parent.postMessage({ type: 'scws-booking-complete' }, '*')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isSubmitted) {
    return (
      <div className="p-4 text-center">
        <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
          <CheckCircle className="h-6 w-6 text-green-600" />
        </div>
        <h2 className="text-lg font-bold mb-2">Request Submitted!</h2>
        <p className="text-gray-600 text-sm">
          We'll call you within 30 minutes to confirm.
        </p>
        <p className="text-sm mt-3">
          <a href="tel:+17604408520" className="text-blue-600 font-medium">(760) 440-8520</a>
        </p>
      </div>
    )
  }

  return (
    <div className="p-4 max-w-md mx-auto font-sans">
      <div className="mb-4">
        <h2 className="text-lg font-bold text-gray-900">Book Well Service</h2>
        <p className="text-sm text-gray-500">Get a callback within 30 minutes</p>
      </div>

      {/* Service Type */}
      <div className="mb-4">
        <label className="text-sm font-medium text-gray-700 block mb-2">Service Needed</label>
        <div className="grid grid-cols-3 gap-2">
          {serviceTypes.map((service) => (
            <button
              key={service.id}
              onClick={() => setSelectedService(service.id)}
              className={`p-2 text-xs rounded-lg border text-center transition-all ${
                selectedService === service.id
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-gray-200 hover:border-gray-300'
              } ${service.urgent ? 'border-red-200' : ''}`}
            >
              <service.icon className={`h-4 w-4 mx-auto mb-1 ${
                service.urgent ? 'text-red-500' : 'text-gray-500'
              }`} />
              {service.name}
            </button>
          ))}
        </div>
      </div>

      {/* Quick Date Selection */}
      <div className="mb-4">
        <label className="text-sm font-medium text-gray-700 block mb-2">Preferred Date</label>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {availableSlots.map((day) => (
            <button
              key={day.date}
              onClick={() => setSelectedDate(day.date)}
              className={`px-3 py-2 text-xs rounded-lg border whitespace-nowrap ${
                selectedDate === day.date
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              {day.display}
            </button>
          ))}
        </div>
      </div>

      {/* Time Selection */}
      {selectedDate && (
        <div className="mb-4">
          <label className="text-sm font-medium text-gray-700 block mb-2">Preferred Time</label>
          <div className="grid grid-cols-5 gap-1">
            {timeSlots.map((time) => (
              <button
                key={time}
                onClick={() => setSelectedTime(time)}
                className={`px-2 py-1.5 text-xs rounded border ${
                  selectedTime === time
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                {time}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Contact Info */}
      <div className="space-y-3 mb-4">
        <div className="grid grid-cols-2 gap-2">
          <input
            type="text"
            placeholder="Your Name *"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-blue-500"
          />
          <input
            type="tel"
            placeholder="Phone *"
            value={formData.phone}
            onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
            className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-blue-500"
          />
        </div>
        <input
          type="text"
          placeholder="Service Address *"
          value={formData.address}
          onChange={(e) => setFormData({ ...formData, address: e.target.value })}
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-blue-500"
        />
        <div className="grid grid-cols-2 gap-2">
          <select
            value={formData.city}
            onChange={(e) => setFormData({ ...formData, city: e.target.value })}
            className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-blue-500"
          >
            <option value="">City *</option>
            <option value="Ramona">Ramona</option>
            <option value="Valley Center">Valley Center</option>
            <option value="Escondido">Escondido</option>
            <option value="Poway">Poway</option>
            <option value="Julian">Julian</option>
            <option value="Fallbrook">Fallbrook</option>
            <option value="Other">Other</option>
          </select>
          <input
            type="email"
            placeholder="Email"
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-blue-500"
          />
        </div>
      </div>

      {error && (
        <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-xs">
          {error}
        </div>
      )}

      <button
        onClick={handleSubmit}
        disabled={!selectedService || !formData.name || !formData.phone || !formData.address || !formData.city || isSubmitting}
        className="w-full py-3 bg-[#1f3b4d] text-white font-medium rounded-lg hover:bg-[#2a4d63] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {isSubmitting ? 'Submitting...' : 'Request Callback'}
      </button>

      <p className="text-center text-xs text-gray-500 mt-3">
        Or call <a href="tel:+17604408520" className="text-blue-600">(760) 440-8520</a>
      </p>
    </div>
  )
}
