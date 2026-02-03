/**
 * SCWS Booking Widget Embed Script
 * 
 * Usage:
 * <div id="scws-booking"></div>
 * <script src="https://jobs.scwellservice.com/embed/booking-widget.js"></script>
 * 
 * Or with custom options:
 * <script>
 *   window.SCWS_BOOKING = {
 *     containerId: 'my-booking-container',
 *     height: '600px'
 *   };
 * </script>
 * <script src="https://jobs.scwellservice.com/embed/booking-widget.js"></script>
 */

(function() {
  'use strict';

  var config = window.SCWS_BOOKING || {};
  var containerId = config.containerId || 'scws-booking';
  var height = config.height || '520px';
  var baseUrl = config.baseUrl || 'https://jobs.scwellservice.com';

  function init() {
    var container = document.getElementById(containerId);
    
    if (!container) {
      console.warn('[SCWS Booking] Container not found: #' + containerId);
      return;
    }

    // Create iframe
    var iframe = document.createElement('iframe');
    iframe.src = baseUrl + '/book/embed';
    iframe.style.width = '100%';
    iframe.style.height = height;
    iframe.style.border = 'none';
    iframe.style.borderRadius = '8px';
    iframe.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
    iframe.title = 'Book Well Service';
    iframe.loading = 'lazy';

    // Listen for messages from iframe
    window.addEventListener('message', function(event) {
      if (event.origin !== baseUrl) return;
      
      if (event.data && event.data.type === 'scws-booking-complete') {
        // Booking completed - you can add custom handling here
        console.log('[SCWS Booking] Booking submitted successfully');
        
        // Optional: dispatch custom event for the embedding page
        var customEvent = new CustomEvent('scws:booking-complete');
        document.dispatchEvent(customEvent);
      }
    });

    container.appendChild(iframe);
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
