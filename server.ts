import "dotenv/config";
import express, { Request, Response } from "express";
import { loginAndProcessOffices, testPDFDownload } from "./kinnser-billing-automation";
import { OFFICES } from "./office-config";
import { InsuranceHelper } from "./insurance-helper";

const app = express();
const PORT = process.env.PORT || 8080;

// Load insurance data
const insuranceHelper = new InsuranceHelper("Insurance Instructions.xlsx");

app.use(express.json());
app.use(express.static("public"));

// Health check
app.get("/health", (req: Request, res: Response) => {
  res.json({ 
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: "1.0.0"
  });
});

// API endpoint to get insurances for an office
app.get("/api/insurances/:stateCode", (req: Request, res: Response) => {
  try {
    const { stateCode } = req.params;
    const insurances = insuranceHelper.getProcessableInsurancesByLocation(stateCode);
    res.json({ insurances });
  } catch (error) {
    console.error("Failed to get insurances:", error);
    res.status(500).json({ error: "Failed to load insurances" });
  }
});

// Billing automation page
app.get("/billing", (req: Request, res: Response) => {
  // Generate office buttons
  const officeButtons = OFFICES.map(office => `
    <div class="office-card">
      <div class="office-header">
        <h3>${office.name}</h3>
        <span class="state-badge">${office.stateCode}</span>
      </div>
      <button class="office-btn" onclick="showInsuranceModal('${office.value}', '${office.name}', '${office.stateCode}')">
        <svg class="btn-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"></path>
        </svg>
        Select Insurances
      </button>
    </div>
  `).join('\n');

  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Kinnser Billing Automation - SOLT Healthcare</title>
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        
        body {
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          min-height: 100vh;
          padding: 20px;
          color: #333;
        }
        
        .container {
          max-width: 1400px;
          margin: 0 auto;
        }
        
        .header {
          background: white;
          border-radius: 16px;
          padding: 40px;
          margin-bottom: 30px;
          box-shadow: 0 10px 40px rgba(0,0,0,0.1);
        }
        
        .header h1 {
          font-size: 2.5rem;
          font-weight: 700;
          color: #1a202c;
          margin-bottom: 10px;
        }
        
        .header .subtitle {
          font-size: 1.1rem;
          color: #718096;
          font-weight: 500;
        }
        
        .info-box {
          background: #edf2f7;
          border-left: 4px solid #667eea;
          padding: 20px 24px;
          border-radius: 8px;
          margin-top: 24px;
        }
        
        .info-box h3 {
          font-size: 1rem;
          font-weight: 600;
          color: #2d3748;
          margin-bottom: 12px;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        
        .info-box ul {
          list-style: none;
          padding-left: 0;
        }
        
        .info-box li {
          padding: 6px 0;
          color: #4a5568;
          display: flex;
          align-items: start;
          gap: 8px;
        }
        
        .info-box li:before {
          content: "✓";
          color: #667eea;
          font-weight: bold;
          flex-shrink: 0;
        }
        
        .main-content {
          background: white;
          border-radius: 16px;
          padding: 40px;
          box-shadow: 0 10px 40px rgba(0,0,0,0.1);
        }
        
        .section-title {
          font-size: 1.5rem;
          font-weight: 600;
          color: #1a202c;
          margin-bottom: 24px;
          display: flex;
          align-items: center;
          gap: 12px;
        }
        
        .office-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
          gap: 20px;
          margin-bottom: 30px;
        }
        
        .office-card {
          background: #f7fafc;
          border: 2px solid #e2e8f0;
          border-radius: 12px;
          padding: 20px;
          transition: all 0.3s ease;
        }
        
        .office-card:hover {
          border-color: #667eea;
          box-shadow: 0 4px 12px rgba(102, 126, 234, 0.15);
          transform: translateY(-2px);
        }
        
        .office-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 16px;
        }
        
        .office-header h3 {
          font-size: 1.1rem;
          font-weight: 600;
          color: #2d3748;
        }
        
        .state-badge {
          background: #667eea;
          color: white;
          padding: 4px 12px;
          border-radius: 20px;
          font-size: 0.75rem;
          font-weight: 600;
          letter-spacing: 0.5px;
        }
        
        .office-btn {
          width: 100%;
          padding: 12px 20px;
          font-size: 0.95rem;
          font-weight: 600;
          border: none;
          cursor: pointer;
          border-radius: 8px;
          transition: all 0.3s;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
        }
        
        .office-btn:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 6px 20px rgba(102, 126, 234, 0.4);
        }
        
        .office-btn:disabled {
          background: #cbd5e0;
          cursor: not-allowed;
          transform: none;
        }
        
        .btn-icon {
          width: 20px;
          height: 20px;
        }
        
        .all-offices-section {
          margin-top: 30px;
          padding-top: 30px;
          border-top: 2px solid #e2e8f0;
        }
        
        .all-offices-btn {
          width: 100%;
          padding: 20px;
          font-size: 1.1rem;
          font-weight: 700;
          border: none;
          cursor: pointer;
          border-radius: 12px;
          transition: all 0.3s;
          background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
          color: white;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          box-shadow: 0 4px 15px rgba(245, 87, 108, 0.3);
        }
        
        .all-offices-btn:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 8px 25px rgba(245, 87, 108, 0.4);
        }
        
        .all-offices-btn:disabled {
          background: #cbd5e0;
          cursor: not-allowed;
          transform: none;
          box-shadow: none;
        }
        
        #results {
          margin-top: 30px;
          padding: 24px;
          border-radius: 12px;
          display: none;
          animation: slideIn 0.3s ease;
        }
        
        @keyframes slideIn {
          from {
            opacity: 0;
            transform: translateY(-10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        
        #results.loading {
          background: #fff5e6;
          border: 2px solid #ffa726;
        }
        
        #results.success {
          background: #e8f5e9;
          border: 2px solid #66bb6a;
        }
        
        #results.error {
          background: #ffebee;
          border: 2px solid #ef5350;
        }
        
        .result-header {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 16px;
          font-size: 1.2rem;
          font-weight: 600;
        }
        
        .result-icon {
          width: 28px;
          height: 28px;
        }
        
        .result-details {
          background: white;
          padding: 16px;
          border-radius: 8px;
          margin-top: 12px;
        }
        
        .result-row {
          display: flex;
          justify-content: space-between;
          padding: 8px 0;
          border-bottom: 1px solid #e2e8f0;
        }
        
        .result-row:last-child {
          border-bottom: none;
        }
        
        .result-label {
          font-weight: 600;
          color: #4a5568;
        }
        
        .result-value {
          color: #2d3748;
        }
        
        .spinner {
          display: inline-block;
          width: 20px;
          height: 20px;
          border: 3px solid rgba(255,255,255,0.3);
          border-radius: 50%;
          border-top-color: white;
          animation: spin 1s ease-in-out infinite;
        }
        
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        
        details {
          margin-top: 12px;
        }
        
        summary {
          cursor: pointer;
          font-weight: 600;
          color: #667eea;
          padding: 8px;
          border-radius: 4px;
          transition: background 0.2s;
        }
        
        summary:hover {
          background: #edf2f7;
        }
        
        pre {
          background: #f7fafc;
          padding: 12px;
          border-radius: 6px;
          overflow-x: auto;
          margin-top: 8px;
          font-size: 0.85rem;
        }
        
        .footer {
          text-align: center;
          margin-top: 30px;
          padding: 20px;
          color: white;
          font-size: 0.9rem;
        }
        
        @media (max-width: 768px) {
          .header h1 {
            font-size: 1.8rem;
          }
          
          .office-grid {
            grid-template-columns: 1fr;
          }
        }
        
        /* Modal Styles */
        .modal {
          display: none;
          position: fixed;
          z-index: 1000;
          left: 0;
          top: 0;
          width: 100%;
          height: 100%;
          background: rgba(0, 0, 0, 0.5);
          animation: fadeIn 0.3s ease;
        }
        
        .modal.show {
          display: flex;
          align-items: center;
          justify-content: center;
        }
        
        .modal-content {
          background: white;
          border-radius: 16px;
          padding: 32px;
          max-width: 600px;
          width: 90%;
          max-height: 80vh;
          overflow-y: auto;
          box-shadow: 0 20px 60px rgba(0,0,0,0.3);
          animation: slideUp 0.3s ease;
        }
        
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        
        @keyframes slideUp {
          from { 
            opacity: 0;
            transform: translateY(20px);
          }
          to { 
            opacity: 1;
            transform: translateY(0);
          }
        }
        
        .modal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 24px;
          padding-bottom: 16px;
          border-bottom: 2px solid #e2e8f0;
        }
        
        .modal-header h2 {
          font-size: 1.5rem;
          color: #1a202c;
        }
        
        .close-btn {
          background: none;
          border: none;
          font-size: 28px;
          color: #718096;
          cursor: pointer;
          padding: 0;
          width: 32px;
          height: 32px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 4px;
          transition: all 0.2s;
        }
        
        .close-btn:hover {
          background: #f7fafc;
          color: #1a202c;
        }
        
        .insurance-list {
          margin: 20px 0;
        }
        
        .insurance-item {
          display: flex;
          align-items: center;
          padding: 12px;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          margin-bottom: 8px;
          transition: all 0.2s;
        }
        
        .insurance-item:hover {
          background: #f7fafc;
          border-color: #cbd5e0;
        }
        
        .insurance-item input[type="checkbox"] {
          width: 20px;
          height: 20px;
          margin-right: 12px;
          cursor: pointer;
        }
        
        .insurance-item label {
          cursor: pointer;
          flex: 1;
          font-size: 0.95rem;
          color: #2d3748;
        }
        
        .select-all-section {
          margin-bottom: 16px;
          padding: 12px;
          background: #edf2f7;
          border-radius: 8px;
        }
        
        .select-all-section label {
          display: flex;
          align-items: center;
          cursor: pointer;
          font-weight: 600;
          color: #2d3748;
        }
        
        .select-all-section input[type="checkbox"] {
          width: 20px;
          height: 20px;
          margin-right: 12px;
          cursor: pointer;
        }
        
        .modal-actions {
          display: flex;
          gap: 12px;
          margin-top: 24px;
          padding-top: 20px;
          border-top: 2px solid #e2e8f0;
        }
        
        .modal-btn {
          flex: 1;
          padding: 14px 24px;
          font-size: 1rem;
          font-weight: 600;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.3s;
        }
        
        .modal-btn-primary {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
        }
        
        .modal-btn-primary:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 6px 20px rgba(102, 126, 234, 0.4);
        }
        
        .modal-btn-primary:disabled {
          background: #cbd5e0;
          cursor: not-allowed;
        }
        
        .modal-btn-secondary {
          background: #e2e8f0;
          color: #2d3748;
        }
        
        .modal-btn-secondary:hover {
          background: #cbd5e0;
        }
        
        .loading-spinner {
          text-align: center;
          padding: 20px;
          color: #718096;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>🏥 Kinnser Billing Automation</h1>
          <p class="subtitle">SOLT Healthcare - Automated Claims Processing</p>
          
          <div class="info-box">
            <h3>
              <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
              </svg>
              How It Works
            </h3>
            <ul>
              <li>Select an office to process billing records for that location</li>
              <li>The system validates insurance and authorization data automatically</li>
              <li>Valid records are selected and saved to Excel for review</li>
              <li>Results are emailed to nvenu@solifetec.com with detailed reports</li>
              <li><strong>Note:</strong> Create button is disabled - records are selected for verification only</li>
            </ul>
          </div>
        </div>
        
        <div class="main-content">
          <h2 class="section-title">
            <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"></path>
            </svg>
            Select Office
          </h2>
          
          <div class="office-grid">
            ${officeButtons}
          </div>
          
          <div class="all-offices-section">
            <button class="all-offices-btn" onclick="runAutomation('all', 'All Offices', 'ALL')">
              <svg class="btn-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path>
              </svg>
              Process All Offices (${OFFICES.length} locations)
            </button>
          </div>
          
          <div id="results"></div>
        </div>
        
        <div class="footer">
          <p>© 2026 SOLT Healthcare | Automated Billing System v1.0</p>
        </div>
      </div>

      <!-- Insurance Selection Modal -->
      <div id="insuranceModal" class="modal">
        <div class="modal-content">
          <div class="modal-header">
            <h2>Select Insurances</h2>
            <button class="close-btn" onclick="closeModal()">&times;</button>
          </div>
          
          <div id="modalBody">
            <div class="loading-spinner">Loading insurances...</div>
          </div>
          
          <div class="modal-actions">
            <button class="modal-btn modal-btn-secondary" onclick="closeModal()">Cancel</button>
            <button id="processBtn" class="modal-btn modal-btn-primary" onclick="processSelectedInsurances()" disabled>
              Process Selected
            </button>
          </div>
        </div>
      </div>

      <script>
        let currentOffice = null;
        
        async function showInsuranceModal(officeValue, officeName, stateCode) {
          console.log('showInsuranceModal called with:', { officeValue, officeName, stateCode });
          currentOffice = { officeValue, officeName, stateCode };
          console.log('currentOffice set to:', currentOffice);
          
          const modal = document.getElementById('insuranceModal');
          const modalBody = document.getElementById('modalBody');
          
          modal.classList.add('show');
          modalBody.innerHTML = '<div class="loading-spinner">Loading insurances...</div>';
          
          try {
            const response = await fetch(\`/api/insurances/\${stateCode}\`);
            const data = await response.json();
            
            if (data.insurances && data.insurances.length > 0) {
              let html = \`
                <div class="select-all-section">
                  <label>
                    <input type="checkbox" id="selectAll" onchange="toggleSelectAll(this)">
                    Select All (\${data.insurances.length} insurances)
                  </label>
                </div>
                <div class="insurance-list">
              \`;
              
              data.insurances.forEach((insurance, index) => {
                html += \`
                  <div class="insurance-item">
                    <input type="checkbox" id="insurance-\${index}" class="insurance-checkbox" 
                           value="\${insurance}" onchange="updateProcessButton()">
                    <label for="insurance-\${index}">\${insurance}</label>
                  </div>
                \`;
              });
              
              html += '</div>';
              modalBody.innerHTML = html;
              
              // Auto-select all insurances by default for convenience
              setTimeout(() => {
                const selectAllCheckbox = document.getElementById('selectAll');
                if (selectAllCheckbox) {
                  selectAllCheckbox.checked = true;
                  toggleSelectAll(selectAllCheckbox);
                }
              }, 100);
            } else {
              modalBody.innerHTML = '<p style="color: #718096; text-align: center;">No insurances found for this office.</p>';
            }
          } catch (error) {
            modalBody.innerHTML = '<p style="color: #ef5350; text-align: center;">Failed to load insurances. Please try again.</p>';
          }
        }
        
        function closeModal() {
          console.log('closeModal called');
          const modal = document.getElementById('insuranceModal');
          modal.classList.remove('show');
          // Don't reset currentOffice here - we need it for processing
          // currentOffice = null;
        }
        
        function toggleSelectAll(checkbox) {
          const checkboxes = document.querySelectorAll('.insurance-checkbox');
          checkboxes.forEach(cb => cb.checked = checkbox.checked);
          updateProcessButton();
        }
        
        function updateProcessButton() {
          const checkboxes = document.querySelectorAll('.insurance-checkbox');
          const anyChecked = Array.from(checkboxes).some(cb => cb.checked);
          document.getElementById('processBtn').disabled = !anyChecked;
          
          const selectAll = document.getElementById('selectAll');
          if (selectAll) {
            const allChecked = Array.from(checkboxes).every(cb => cb.checked);
            const someChecked = Array.from(checkboxes).some(cb => cb.checked);
            selectAll.checked = allChecked;
            selectAll.indeterminate = someChecked && !allChecked;
          }
        }
        
        async function processSelectedInsurances() {
          console.log('processSelectedInsurances called');
          console.log('currentOffice before processing:', currentOffice);
          
          if (!currentOffice) {
            console.error('No current office selected');
            alert('Error: No office selected. Please try again.');
            return;
          }
          
          const checkboxes = document.querySelectorAll('.insurance-checkbox:checked');
          const selectedInsurances = Array.from(checkboxes).map(cb => cb.value);
          
          console.log('Selected insurances:', selectedInsurances);
          
          if (selectedInsurances.length === 0) {
            alert('Please select at least one insurance');
            return;
          }
          
          // Save office info before closing modal
          const officeInfo = { ...currentOffice };
          
          closeModal();
          console.log('Starting automation for:', officeInfo.officeName);
          await runAutomation(officeInfo.officeValue, officeInfo.officeName, officeInfo.stateCode, selectedInsurances);
          
          // Reset after processing
          currentOffice = null;
        }
        
        async function runAutomation(officeValue, officeName, stateCode, selectedInsurances = null) {
          const buttons = document.querySelectorAll('button');
          buttons.forEach(btn => btn.disabled = true);
          
          const results = document.getElementById('results');
          results.style.display = 'block';
          results.className = 'loading';
          
          const insuranceInfo = selectedInsurances ? 
            \`<p style="color: #666; margin-top: 8px;">Processing \${selectedInsurances.length} selected insurance(s)...</p>\` : 
            '';
          
          results.innerHTML = \`
            <div class="result-header">
              <div class="spinner"></div>
              Processing <strong>\${officeName}</strong>...
            </div>
            <p style="color: #666; margin-top: 8px;">This may take several minutes. Please wait...</p>
            \${insuranceInfo}
          \`;
          
          try {
            const response = await fetch('/run-automation', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ officeValue, selectedInsurances })
            });
            
            const data = await response.json();
            
            if (response.ok) {
              results.className = 'success';
              results.innerHTML = \`
                <div class="result-header">
                  <svg class="result-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                  </svg>
                  Automation Completed Successfully!
                </div>
                <div class="result-details">
                  <div class="result-row">
                    <span class="result-label">Office:</span>
                    <span class="result-value">\${officeName}</span>
                  </div>
                  <div class="result-row">
                    <span class="result-label">Records Selected:</span>
                    <span class="result-value">\${data.totalRecords}</span>
                  </div>
                  <div class="result-row">
                    <span class="result-label">Excel Files Created:</span>
                    <span class="result-value">\${data.filesCreated}</span>
                  </div>
                  <div class="result-row">
                    <span class="result-label">Email Sent:</span>
                    <span class="result-value">\${data.emailSent ? '✓ Yes' : '✗ No'}</span>
                  </div>
                </div>
                <details>
                  <summary>View Detailed Summary</summary>
                  <pre>\${JSON.stringify(data.summary, null, 2)}</pre>
                </details>
              \`;
            } else {
              results.className = 'error';
              results.innerHTML = \`
                <div class="result-header">
                  <svg class="result-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                  </svg>
                  Error Occurred
                </div>
                <div class="result-details">
                  <p style="color: #c53030;">\${data.error}</p>
                </div>
              \`;
            }
          } catch (error) {
            results.className = 'error';
            results.innerHTML = \`
              <div class="result-header">
                <svg class="result-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                </svg>
                Connection Error
              </div>
              <div class="result-details">
                <p style="color: #c53030;">Failed to connect to server. Please check if the server is running.</p>
              </div>
            \`;
          } finally {
            buttons.forEach(btn => btn.disabled = false);
          }
        }
      </script>
    </body>
    </html>
  `);
});

// Health check (moved to top, keeping this for backward compatibility)
app.get("/health", (req: Request, res: Response) => {
  res.json({ 
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: "1.0.0"
  });
});

// API endpoint to run automation
app.post("/run-automation", async (req: Request, res: Response) => {
  try {
    const { officeValue, selectedInsurances } = req.body;
    console.log(`Starting Kinnser automation for: ${officeValue}`);
    if (selectedInsurances) {
      console.log(`Selected insurances: ${selectedInsurances.join(', ')}`);
    }
    
    const result = await loginAndProcessOffices(officeValue, selectedInsurances);
    
    res.json({
      success: true,
      totalRecords: result.totalRecords,
      filesCreated: result.filesCreated,
      emailSent: result.emailSent,
      summary: result.summary
    });
  } catch (error) {
    console.error("Automation failed:", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

// TEST endpoint to test PDF download from Ready To Send
app.post("/test-pdf-download", async (req: Request, res: Response) => {
  try {
    const { officeValue } = req.body;
    console.log(`Starting PDF download test for: ${officeValue || 'MA-Nightingale___Taunton'}`);
    
    await testPDFDownload(officeValue);
    
    res.json({
      success: true,
      message: "PDF download test completed successfully"
    });
  } catch (error) {
    console.error("PDF download test failed:", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Open your browser and visit: http://localhost:${PORT}`);
});
