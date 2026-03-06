import { useState, useEffect } from 'react'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js'
import { Bar, Line } from 'react-chartjs-2'

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Title,
  Tooltip,
  Legend,
)

// ============================================================================
// API Response Types
// ============================================================================

export interface ScoreBucket {
  bucket: string
  count: number
}

export interface TimelineEntry {
  date: string
  submissions: number
}

export interface PassRateEntry {
  task: string
  avg_score: number
  attempts: number
}

export interface LabOption {
  value: string
  label: string
}

// ============================================================================
// Chart Data Types (from react-chartjs-2)
// ============================================================================

interface ChartData {
  labels: string[]
  datasets: {
    label: string
    data: number[]
    backgroundColor?: string | string[]
    borderColor?: string | string[]
    fill?: boolean
    tension?: number
    borderWidth?: number
  }[]
}

// ============================================================================
// Component State Types
// ============================================================================

interface FetchState<T> {
  status: 'idle' | 'loading' | 'success' | 'error'
  data: T | null
  error: string | null
}

// ============================================================================
// API Functions
// ============================================================================

const API_BASE = '/analytics'

async function fetchWithAuth<T>(
  endpoint: string,
  params: Record<string, string>,
): Promise<T> {
  const apiKey = localStorage.getItem('api_key')
  if (!apiKey) {
    throw new Error('API key not found in localStorage')
  }

  const url = new URL(endpoint, window.location.origin)
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value)
  })

  const response = await fetch(url.pathname + url.search, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  })

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  }

  return response.json()
}

// ============================================================================
// Main Component
// ============================================================================

export default function Dashboard() {
  const [selectedLab, setSelectedLab] = useState<string>('lab-04')
  const [scoresState, setScoresState] = useState<FetchState<ScoreBucket[]>>({
    status: 'idle',
    data: null,
    error: null,
  })
  const [timelineState, setTimelineState] = useState<
    FetchState<TimelineEntry[]>
  >({
    status: 'idle',
    data: null,
    error: null,
  })
  const [passRatesState, setPassRatesState] = useState<
    FetchState<PassRateEntry[]>
  >({
    status: 'idle',
    data: null,
    error: null,
  })

  // Available labs for the dropdown
  const labs: LabOption[] = [
    { value: 'lab-03', label: 'Lab 03 — Backend' },
    { value: 'lab-04', label: 'Lab 04 — Testing' },
  ]

  // Fetch analytics data when lab selection changes
  useEffect(() => {
    const controller = new AbortController()

    async function fetchAllData() {
      // Reset states
      setScoresState({ status: 'loading', data: null, error: null })
      setTimelineState({ status: 'loading', data: null, error: null })
      setPassRatesState({ status: 'loading', data: null, error: null })

      try {
        const [scores, timeline, passRates] = await Promise.all([
          fetchWithAuth<ScoreBucket[]>(`${API_BASE}/scores`, {
            lab: selectedLab,
          }),
          fetchWithAuth<TimelineEntry[]>(`${API_BASE}/timeline`, {
            lab: selectedLab,
          }),
          fetchWithAuth<PassRateEntry[]>(`${API_BASE}/pass-rates`, {
            lab: selectedLab,
          }),
        ])

        setScoresState({ status: 'success', data: scores, error: null })
        setTimelineState({ status: 'success', data: timeline, error: null })
        setPassRatesState({ status: 'success', data: passRates, error: null })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        setScoresState({ status: 'error', data: null, error: message })
        setTimelineState({ status: 'error', data: null, error: message })
        setPassRatesState({ status: 'error', data: null, error: message })
      }
    }

    void fetchAllData()

    return () => {
      controller.abort()
    }
  }, [selectedLab])

  // Prepare bar chart data for score buckets
  const scoreChartData: ChartData = {
    labels:
      scoresState.data?.map((item) => item.bucket) ?? ['0-25', '26-50', '51-75', '76-100'],
    datasets: [
      {
        label: 'Number of Students',
        data: scoresState.data?.map((item) => item.count) ?? [0, 0, 0, 0],
        backgroundColor: [
          'rgba(255, 99, 132, 0.7)',
          'rgba(255, 159, 64, 0.7)',
          'rgba(75, 192, 192, 0.7)',
          'rgba(54, 162, 235, 0.7)',
        ],
        borderColor: [
          'rgb(255, 99, 132)',
          'rgb(255, 159, 64)',
          'rgb(75, 192, 192)',
          'rgb(54, 162, 235)',
        ],
        borderWidth: 1,
      },
    ],
  }

  // Prepare line chart data for timeline
  const timelineChartData: ChartData = {
    labels: timelineState.data?.map((item) => item.date) ?? [],
    datasets: [
      {
        label: 'Submissions',
        data: timelineState.data?.map((item) => item.submissions) ?? [],
        borderColor: 'rgb(75, 192, 192)',
        backgroundColor: 'rgba(75, 192, 192, 0.5)',
        fill: true,
        tension: 0.3,
      },
    ],
  }

  const chartOptions = {
    responsive: true,
    plugins: {
      legend: {
        display: true,
        position: 'top' as const,
      },
      title: {
        display: false,
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        ticks: {
          stepSize: 1,
        },
      },
    },
  }

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h1>Analytics Dashboard</h1>
        <div className="lab-selector">
          <label htmlFor="lab-select">Select Lab:</label>
          <select
            id="lab-select"
            value={selectedLab}
            onChange={(e) => setSelectedLab(e.target.value)}
          >
            {labs.map((lab) => (
              <option key={lab.value} value={lab.value}>
                {lab.label}
              </option>
            ))}
          </select>
        </div>
      </header>

      {/* Error Banner */}
      {(scoresState.status === 'error' ||
        timelineState.status === 'error' ||
        passRatesState.status === 'error') && (
        <div className="error-banner">
          Error loading analytics data. Please check your API connection.
        </div>
      )}

      {/* Loading State */}
      {(scoresState.status === 'loading' ||
        timelineState.status === 'loading' ||
        passRatesState.status === 'loading') && (
        <div className="loading-state">Loading analytics...</div>
      )}

      {/* Score Distribution Chart */}
      <section className="chart-section">
        <h2>Score Distribution</h2>
        {scoresState.status === 'success' && scoresState.data ? (
          <Bar data={scoreChartData} options={chartOptions} />
        ) : (
          <div className="chart-placeholder">No score data available</div>
        )}
      </section>

      {/* Timeline Chart */}
      <section className="chart-section">
        <h2>Submission Timeline</h2>
        {timelineState.status === 'success' && timelineState.data ? (
          <Line data={timelineChartData} options={chartOptions} />
        ) : (
          <div className="chart-placeholder">No timeline data available</div>
        )}
      </section>

      {/* Pass Rates Table */}
      <section className="table-section">
        <h2>Pass Rates by Task</h2>
        {passRatesState.status === 'success' && passRatesState.data ? (
          <table className="pass-rates-table">
            <thead>
              <tr>
                <th>Task</th>
                <th>Avg Score</th>
                <th>Attempts</th>
              </tr>
            </thead>
            <tbody>
              {passRatesState.data.map((entry, index) => (
                <tr key={`${entry.task}-${index}`}>
                  <td>{entry.task}</td>
                  <td>{entry.avg_score.toFixed(1)}</td>
                  <td>{entry.attempts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="table-placeholder">No pass rate data available</div>
        )}
      </section>
    </div>
  )
}
