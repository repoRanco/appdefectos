// reports.js
document.addEventListener('DOMContentLoaded', function() {
    // Initialize date pickers
    const startDateInput = document.getElementById('startDate');
    const endDateInput = document.getElementById('endDate');
    const today = new Date().toISOString().split('T')[0];
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
    const oneMonthAgoStr = oneMonthAgo.toISOString().split('T')[0];
    
    startDateInput.value = oneMonthAgoStr;
    endDateInput.value = today;
    endDateInput.max = today;
    
    // Load data on page load
    loadReportsData();
    
    // Add event listeners for filters
    document.getElementById('filterForm').addEventListener('submit', function(e) {
        e.preventDefault();
        loadReportsData();
    });
    
    // Add event listener for export buttons
    document.getElementById('exportCsv').addEventListener('click', exportToCsv);
    document.getElementById('exportPdf').addEventListener('click', exportToPdf);
});

async function loadReportsData() {
    try {
        showLoading(true);
        const response = await fetch('/api/reports/data');
        if (!response.ok) {
            throw new Error('Error al cargar los datos');
        }
        const data = await response.json();
        updateReportsUI(data);
    } catch (error) {
        console.error('Error:', error);
        showError('Error al cargar los datos: ' + error.message);
    } finally {
        showLoading(false);
    }
}

function updateReportsUI(data) {
    const resultsTable = document.getElementById('resultsTable');
    const tbody = resultsTable.querySelector('tbody');
    tbody.innerHTML = '';
    
    if (!data || data.length === 0) {
        const row = document.createElement('tr');
        row.innerHTML = '<td colspan="7" class="text-center">No se encontraron resultados</td>';
        tbody.appendChild(row);
        return;
    }
    
    data.forEach(item => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${new Date(item.timestamp).toLocaleString()}</td>
            <td>${item.user_name || 'N/A'}</td>
            <td>${item.analysis_type || 'N/A'}</td>
            <td>${item.distribucion || 'N/A'}</td>
            <td>${item.lote || 'N/A'}</td>
            <td>${item.total_detections || 0}</td>
            <td>
                <button class="btn btn-sm btn-info" onclick="showAnalysisDetails(${item.id})">
                    Ver Detalles
                </button>
            </td>
        `;
        tbody.appendChild(row);
    });
}

async function showAnalysisDetails(analysisId) {
    try {
        const response = await fetch(`/api/reports/detail/${analysisId}`);
        if (!response.ok) {
            throw new Error('Error al cargar los detalles');
        }
        const data = await response.json();
        // Show details in a modal
        showDetailsModal(data);
    } catch (error) {
        console.error('Error:', error);
        showError('Error al cargar los detalles: ' + error.message);
    }
}

function showDetailsModal(data) {
    // Implement modal display logic here
    console.log('Analysis details:', data);
    // You can use a library like Bootstrap's modal or implement your own
    alert('Detalles del análisis:\n' + JSON.stringify(data, null, 2));
}

async function exportToCsv() {
    try {
        showLoading(true);
        const response = await fetch('/api/reports/export/csv');
        if (!response.ok) {
            throw new Error('Error al exportar a CSV');
        }
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `reporte_${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    } catch (error) {
        console.error('Error:', error);
        showError('Error al exportar a CSV: ' + error.message);
    } finally {
        showLoading(false);
    }
}

function exportToPdf() {
    // Placeholder for PDF export
    alert('La exportación a PDF está en desarrollo');
}

function showLoading(show) {
    const loadingElement = document.getElementById('loading');
    if (loadingElement) {
        loadingElement.style.display = show ? 'block' : 'none';
    }
}

function showError(message) {
    // Implement error display logic
    console.error(message);
    alert(message);
}