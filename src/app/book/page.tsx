'use client'

import { useState } from 'react'
import { 
  Calendar,
  Clock,
  MapPin,
  Phone,
  Mail,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Droplets,
  Wrench,
  Search,
  AlertTriangle
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const serviceTypes = [
  { id: 'pump_repair', name: 'Well Pump Repair', icon: Wrench, description: 'Fix or replace your well pump' },
  { id: 'no_water', name: 'No Water Emergency', icon: AlertTriangle, description: 'Urgent - no water at all', urgent: true },
  { id: 'low_pressure', name: 'Low Water Pressure', icon: Droplets, description: 'Weak flow or pressure issues' },
  { id: 'inspection', name: 'Well Inspection', icon: Search, description: 'Annual checkup & water test' },
  { id: 'new_well', name: 'New Well Drilling', icon: Droplets, description: 'Drill a new water well' },
  { id: 'other', name: 'Other Service', icon: Wrench, description: 'Something else' },
]

// Available time slots for the next 7 days
const generateTimeSlots = () => {
  const slots: { date: string; slots: string[] }[] = []
  const today = new Date()
  
  for (let i = 1; i <= 7; i++) {
    const date = new Date(today)
    date.setDate(date.getDate() + i)
    
    // Skip Sundays
    if (date.getDay() === 0) continue
    
    slots.push({
      date: date.toISOString().split('T')[0],
      slots: ['8:00 AM', '10:00 AM', '12:00 PM', '2:00 PM', '4:00 PM']
    })
  }
  return slots
}

export default function BookingPage() {
  const [step, setStep] = useState(1)
  const [selectedService, setSelectedService] = useState<string | null>(null)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [selectedTime, setSelectedTime] = useState<string | null>(null)
  const [isSubmitted, setIsSubmitted] = useState(false)
  
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    email: '',
    address: '',
    city: '',
    description: '',
  })

  const availableSlots = generateTimeSlots()

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const handleSubmit = async () => {
    setIsSubmitting(true)
    setSubmitError(null)

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
          notes: formData.description || null,
          source: 'website',
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to submit request')
      }

      setIsSubmitted(true)
    } catch (error) {
      console.error('Booking submission error:', error)
      setSubmitError(error instanceof Error ? error.message : 'Something went wrong')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isSubmitted) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <Card className="max-w-md w-full text-center">
          <CardContent className="pt-8 pb-8">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="h-8 w-8 text-green-600" />
            </div>
            <h2 className="text-2xl font-bold mb-2">Request Submitted!</h2>
            <p className="text-muted-foreground mb-6">
              We've received your service request. A team member will call you within 30 minutes to confirm your appointment.
            </p>
            <div className="bg-muted p-4 rounded-lg text-left mb-6">
              <div className="text-sm space-y-2">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Service:</span>
                  <span className="font-medium">{serviceTypes.find(s => s.id === selectedService)?.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Date:</span>
                  <span className="font-medium">{selectedDate && new Date(selectedDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Time:</span>
                  <span className="font-medium">{selectedTime}</span>
                </div>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              Questions? Call us at <a href="tel:+17604408520" className="text-primary font-medium">(760) 440-8520</a>
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-[#1f3b4d] text-white py-6">
        <div className="container mx-auto px-4">
          <h1 className="text-2xl font-bold">Southern California Well Service</h1>
          <p className="text-white/80">Book Your Service Online</p>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8 max-w-3xl">
        {/* Progress Steps */}
        <div className="flex items-center justify-center mb-8">
          {[1, 2, 3].map((s) => (
            <div key={s} className="flex items-center">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center font-medium ${
                step >= s ? 'bg-[#1f3b4d] text-white' : 'bg-gray-200 text-gray-500'
              }`}>
                {s}
              </div>
              {s < 3 && (
                <div className={`w-20 h-1 mx-2 ${step > s ? 'bg-[#1f3b4d]' : 'bg-gray-200'}`} />
              )}
            </div>
          ))}
        </div>
        <div className="flex justify-center gap-16 mb-8 text-sm">
          <span className={step >= 1 ? 'font-medium' : 'text-muted-foreground'}>Service</span>
          <span className={step >= 2 ? 'font-medium' : 'text-muted-foreground'}>Schedule</span>
          <span className={step >= 3 ? 'font-medium' : 'text-muted-foreground'}>Details</span>
        </div>

        {/* Step 1: Select Service */}
        {step === 1 && (
          <div>
            <h2 className="text-xl font-bold mb-4 text-center">What do you need help with?</h2>
            <div className="grid gap-3 md:grid-cols-2">
              {serviceTypes.map((service) => (
                <Card 
                  key={service.id}
                  className={`cursor-pointer transition-all hover:shadow-md ${
                    selectedService === service.id 
                      ? 'ring-2 ring-[#1f3b4d] bg-[#1f3b4d]/5' 
                      : ''
                  } ${service.urgent ? 'border-red-200' : ''}`}
                  onClick={() => setSelectedService(service.id)}
                >
                  <CardContent className="p-4 flex items-center gap-4">
                    <div className={`p-3 rounded-full ${
                      service.urgent ? 'bg-red-100' : 'bg-[#1f3b4d]/10'
                    }`}>
                      <service.icon className={`h-5 w-5 ${
                        service.urgent ? 'text-red-600' : 'text-[#1f3b4d]'
                      }`} />
                    </div>
                    <div>
                      <h3 className="font-medium">{service.name}</h3>
                      <p className="text-sm text-muted-foreground">{service.description}</p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
            <div className="mt-8 flex justify-end">
              <Button 
                onClick={() => setStep(2)} 
                disabled={!selectedService}
                className="bg-[#1f3b4d] hover:bg-[#2a4d63]"
              >
                Continue
                <ChevronRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {/* Step 2: Select Date/Time */}
        {step === 2 && (
          <div>
            <h2 className="text-xl font-bold mb-4 text-center">Choose a date and time</h2>
            
            <div className="grid gap-4 md:grid-cols-2">
              {/* Date Selection */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Calendar className="h-4 w-4" />
                    Select Date
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {availableSlots.map((day) => (
                    <Button
                      key={day.date}
                      variant={selectedDate === day.date ? 'default' : 'outline'}
                      className={`w-full justify-start ${selectedDate === day.date ? 'bg-[#1f3b4d]' : ''}`}
                      onClick={() => {
                        setSelectedDate(day.date)
                        setSelectedTime(null)
                      }}
                    >
                      {new Date(day.date).toLocaleDateString('en-US', { 
                        weekday: 'short', 
                        month: 'short', 
                        day: 'numeric' 
                      })}
                    </Button>
                  ))}
                </CardContent>
              </Card>

              {/* Time Selection */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Clock className="h-4 w-4" />
                    Select Time
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {selectedDate ? (
                    availableSlots
                      .find(d => d.date === selectedDate)
                      ?.slots.map((time) => (
                        <Button
                          key={time}
                          variant={selectedTime === time ? 'default' : 'outline'}
                          className={`w-full justify-start ${selectedTime === time ? 'bg-[#1f3b4d]' : ''}`}
                          onClick={() => setSelectedTime(time)}
                        >
                          {time}
                        </Button>
                      ))
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-8">
                      Select a date first
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>

            <div className="mt-8 flex justify-between">
              <Button variant="outline" onClick={() => setStep(1)}>
                <ChevronLeft className="mr-2 h-4 w-4" />
                Back
              </Button>
              <Button 
                onClick={() => setStep(3)} 
                disabled={!selectedDate || !selectedTime}
                className="bg-[#1f3b4d] hover:bg-[#2a4d63]"
              >
                Continue
                <ChevronRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {/* Step 3: Contact Info */}
        {step === 3 && (
          <div>
            <h2 className="text-xl font-bold mb-4 text-center">Your Information</h2>
            
            <Card>
              <CardContent className="pt-6 space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor="name">Full Name *</Label>
                    <Input 
                      id="name" 
                      placeholder="John Smith"
                      value={formData.name}
                      onChange={(e) => setFormData({...formData, name: e.target.value})}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="phone">Phone Number *</Label>
                    <Input 
                      id="phone" 
                      placeholder="(760) 555-1234"
                      value={formData.phone}
                      onChange={(e) => setFormData({...formData, phone: e.target.value})}
                    />
                  </div>
                </div>
                
                <div className="grid gap-2">
                  <Label htmlFor="email">Email</Label>
                  <Input 
                    id="email" 
                    type="email"
                    placeholder="john@email.com"
                    value={formData.email}
                    onChange={(e) => setFormData({...formData, email: e.target.value})}
                  />
                </div>
                
                <div className="grid gap-2">
                  <Label htmlFor="address">Service Address *</Label>
                  <Input 
                    id="address" 
                    placeholder="12345 Desert View Rd"
                    value={formData.address}
                    onChange={(e) => setFormData({...formData, address: e.target.value})}
                  />
                </div>
                
                <div className="grid gap-2">
                  <Label htmlFor="city">City *</Label>
                  <Select onValueChange={(v) => setFormData({...formData, city: v})}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select city" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ramona">Ramona</SelectItem>
                      <SelectItem value="valley-center">Valley Center</SelectItem>
                      <SelectItem value="escondido">Escondido</SelectItem>
                      <SelectItem value="poway">Poway</SelectItem>
                      <SelectItem value="julian">Julian</SelectItem>
                      <SelectItem value="fallbrook">Fallbrook</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="grid gap-2">
                  <Label htmlFor="description">Describe the problem</Label>
                  <Textarea 
                    id="description" 
                    placeholder="Tell us more about what's happening with your well..."
                    rows={3}
                    value={formData.description}
                    onChange={(e) => setFormData({...formData, description: e.target.value})}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Summary */}
            <Card className="mt-4 bg-muted/50">
              <CardContent className="pt-4">
                <h3 className="font-medium mb-2">Appointment Summary</h3>
                <div className="text-sm space-y-1">
                  <div className="flex items-center gap-2">
                    <Wrench className="h-4 w-4 text-muted-foreground" />
                    {serviceTypes.find(s => s.id === selectedService)?.name}
                  </div>
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    {selectedDate && new Date(selectedDate).toLocaleDateString('en-US', { 
                      weekday: 'long', month: 'long', day: 'numeric' 
                    })}
                  </div>
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    {selectedTime}
                  </div>
                </div>
              </CardContent>
            </Card>

            {submitError && (
              <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                {submitError}
              </div>
            )}

            <div className="mt-8 flex justify-between">
              <Button variant="outline" onClick={() => setStep(2)}>
                <ChevronLeft className="mr-2 h-4 w-4" />
                Back
              </Button>
              <Button 
                onClick={handleSubmit} 
                disabled={!formData.name || !formData.phone || !formData.address || !formData.city || isSubmitting}
                className="bg-[#4e9271] hover:bg-[#3d7a5c]"
              >
                {isSubmitting ? (
                  <>
                    <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    Submitting...
                  </>
                ) : (
                  <>
                    <CheckCircle className="mr-2 h-4 w-4" />
                    Submit Request
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {/* Contact Footer */}
        <div className="mt-12 text-center text-sm text-muted-foreground">
          <p>Prefer to call? We're available 24/7 for emergencies</p>
          <a href="tel:+17604408520" className="text-[#1f3b4d] font-medium text-lg">
            (760) 440-8520
          </a>
        </div>
      </div>
    </div>
  )
}
