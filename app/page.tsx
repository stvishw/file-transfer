'use client'
import { useState, useRef, useEffect } from 'react'
import axios from 'axios'
import { FiUpload, FiDownload, FiCheck, FiAlertCircle, FiLock, FiUnlock, FiUser, FiKey, FiPause, FiPlay, FiRotateCw, FiX } from 'react-icons/fi'
import { motion } from 'framer-motion'

type FileMetadata = {
  file_id: string
  status: 'complete' | 'partial' | 'pending' | 'not_found' | 'not_uploaded'
  received_bytes: number
  total_bytes: number
  next_expected_byte: number
  checksum: number
  last_updated: string
}

export default function FileTransfer() {
  const [username, setUsername] = useState<string>('')
  const [password, setPassword] = useState<string>('')
  const [token, setToken] = useState<string>('')
  const [file, setFile] = useState<File | null>(null)
  const [fileId, setFileId] = useState<string>('')
  const [metadata, setMetadata] = useState<FileMetadata | null>(null)
  const [progress, setProgress] = useState<number>(0)
  const [error, setError] = useState<string>('')
  const [isUploading, setIsUploading] = useState<boolean>(false)
  const [isLoggingIn, setIsLoggingIn] = useState<boolean>(false)
  const [speed, setSpeed] = useState<string>('0 KB/s')
  const [timeRemaining, setTimeRemaining] = useState<string>('--')
  const [isResuming, setIsResuming] = useState<boolean>(false)
  const [isPaused, setIsPaused] = useState<boolean>(false)
  const [showResumePrompt, setShowResumePrompt] = useState<boolean>(false)
  const [retryCount, setRetryCount] = useState<number>(0)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const progressRef = useRef<number>(0)
  const lastUpdateRef = useRef<number>(0)
  const activeChunk = useRef<AbortController | null>(null)
  const uploadQueue = useRef<{start: number, end: number}[]>([])

  const CHUNK_SIZE = 1024 * 1024 // 1MB chunks
  const MAX_RETRIES = 3
  const RETRY_DELAY = 1000

  useEffect(() => {
    const savedToken = localStorage.getItem('fileTransferToken')
    const savedUsername = localStorage.getItem('fileTransferUsername')
    if (savedToken && savedUsername) {
      setToken(savedToken)
      setUsername(savedUsername)
      checkForIncompleteUploads()
    }
  }, [])

  useEffect(() => {
    if (token && username) {
      localStorage.setItem('fileTransferToken', token)
      localStorage.setItem('fileTransferUsername', username)
    } else {
      localStorage.removeItem('fileTransferToken')
      localStorage.removeItem('fileTransferUsername')
    }
  }, [token, username])

  const checkForIncompleteUploads = () => {
    const uploads = JSON.parse(localStorage.getItem('incompleteUploads') || '{}')
    const incomplete = Object.values(uploads).find((upload: any) => 
      upload.metadata.status === 'partial'
    )
    setShowResumePrompt(!!incomplete)
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0] || null
    if (!selectedFile) return

    const existingUpload = JSON.parse(
      localStorage.getItem(`upload_${selectedFile.name}`) || 'null'
    )

    if (existingUpload && existingUpload.fileId) {
      setFileId(existingUpload.fileId)
      setMetadata({
        ...existingUpload.metadata,
        status: 'partial'
      })
      setProgress((existingUpload.metadata.received_bytes / existingUpload.metadata.total_bytes) * 100)
      setIsResuming(true)
    } else {
      const newFileId = `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      setFileId(newFileId)
      setMetadata({
        file_id: newFileId,
        status: 'not_uploaded',
        received_bytes: 0,
        total_bytes: selectedFile.size,
        next_expected_byte: 0,
        checksum: 0,
        last_updated: new Date().toISOString()
      })
      setProgress(0)
      setIsResuming(false)
    }

    setFile(selectedFile)
    setShowResumePrompt(false)
  }

  useEffect(() => {
    let timer: NodeJS.Timeout
    
    if (isUploading && !isPaused) {
      timer = setInterval(() => {
        const now = Date.now()
        const timeDiff = (now - lastUpdateRef.current) / 1000
        if (timeDiff > 0 && progressRef.current > 0) {
          const bytesUploaded = (progressRef.current / 100) * (file?.size || 0)
          const bytesPerSecond = bytesUploaded / timeDiff
          setSpeed(formatSpeed(bytesPerSecond))
          
          if (bytesPerSecond > 0) {
            const remainingBytes = (file?.size || 0) - bytesUploaded
            const secondsRemaining = remainingBytes / bytesPerSecond
            setTimeRemaining(formatTime(secondsRemaining))
          }
        }
      }, 1000)
    }

    return () => clearInterval(timer)
  }, [isUploading, isPaused, file?.size])

  const formatSpeed = (bytesPerSecond: number): string => {
    if (bytesPerSecond < 1024) return `${bytesPerSecond.toFixed(0)} B/s`
    if (bytesPerSecond < 1024 * 1024) return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`
    return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`
  }

  const formatTime = (seconds: number): string => {
    if (seconds < 60) return `${Math.ceil(seconds)}s`
    const minutes = Math.floor(seconds / 60)
    const secs = Math.ceil(seconds % 60)
    return `${minutes}m ${secs}s`
  }

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  }

  const login = async (): Promise<void> => {
    try {
      setError('')
      setIsLoggingIn(true)
      
      if (!username || !password) {
        setError('Please enter both username and password')
        return
      }

      const formData = new URLSearchParams()
      formData.append('username', username)
      formData.append('password', password)

      const { data } = await axios.post<{ access_token: string }>(
        'http://localhost:8080/login',
        formData,
        { 
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          withCredentials: true
        }
      )

      setToken(data.access_token)
    } catch (err) {
      handleError(err, 'Login failed. Please check credentials.')
    } finally {
      setIsLoggingIn(false)
    }
  }

  const logout = (): void => {
    setToken('')
    setUsername('')
    setPassword('')
    setFile(null)
    setMetadata(null)
    setProgress(0)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const initUpload = async (): Promise<void> => {
    if (!file || !token) return
    
    try {
      await axios.post(
        `http://localhost:8080/init_upload?file_id=${encodeURIComponent(fileId)}&total_size=${file.size}`,
        null, // No request body needed
        { 
          headers: { 
            'Authorization': `Bearer ${token}`
          },
          withCredentials: true
        }
      )

      uploadQueue.current = []
      for (let start = 0; start < file.size; start += CHUNK_SIZE) {
        uploadQueue.current.push({
          start,
          end: Math.min(start + CHUNK_SIZE, file.size)
        })
      }
    } catch (err) {
      handleError(err, 'Failed to initialize upload')
      throw err
    }
  }

  const uploadChunk = async (
    start: number, 
    end: number,
    onProgress: (progress: number) => void
  ): Promise<void> => {
    if (!file || isPaused) return
    
    activeChunk.current = new AbortController()
    const chunk = file.slice(start, end)
    const formData = new FormData()
    formData.append('chunk', chunk, file.name)

    try {
      await axios.post(
        `http://localhost:8080/upload_chunk?file_id=${encodeURIComponent(fileId)}`,
        formData,
        {
          headers: {
            'Content-Range': `bytes ${start}-${end-1}/${file.size}`,
            'Authorization': `Bearer ${token}`
          },
          signal: activeChunk.current.signal,
          onUploadProgress: (progressEvent) => {
            const percentCompleted = Math.round(
              ((start + (progressEvent.loaded || 0)) / file.size) * 100
            )
            progressRef.current = percentCompleted
            lastUpdateRef.current = Date.now()
            onProgress(percentCompleted)
          }
        }
      )
      setMetadata(prev => prev ? {
        ...prev,
        received_bytes: end,
        next_expected_byte: end,
        last_updated: new Date().toISOString()
      } : null)

      uploadQueue.current = uploadQueue.current.filter(
        chunk => chunk.start !== start
      )
    } catch (err) {
      if (!axios.isCancel(err)) {
        throw err
      }
    }
  }

  const uploadChunkWithRetry = async (
    start: number, 
    end: number, 
    attempt = 1
  ): Promise<void> => {
    if (attempt > MAX_RETRIES) {
      throw new Error(`Failed after ${MAX_RETRIES} attempts`)
    }

    try {
      activeChunk.current = new AbortController()
      await uploadChunk(start, end, (p) => {
        progressRef.current = p
        setProgress(p)
      })
      setRetryCount(0)
    } catch (err) {
      if (!isPaused && !activeChunk.current?.signal.aborted) {
        setRetryCount(attempt)
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * attempt))
        return uploadChunkWithRetry(start, end, attempt + 1)
      }
      throw err
    }
  }

  const uploadFile = async (): Promise<void> => {
    if (!file || !token || !metadata) return

    setError('')
    setIsUploading(true)
    setIsPaused(false)
    progressRef.current = metadata.received_bytes 
      ? (metadata.received_bytes / file.size) * 100 
      : 0
    lastUpdateRef.current = Date.now()

    try {
      if (!isResuming) {
        await initUpload()
      }

      while (uploadQueue.current.length > 0 && !isPaused) {
        const { start, end } = uploadQueue.current[0]
        if (start < (metadata.next_expected_byte || 0)) {
          uploadQueue.current.shift()
          continue
        }

        await uploadChunkWithRetry(start, end)
      }

      if (progress === 100) {
        localStorage.removeItem(`upload_${file.name}`)
        setMetadata(prev => prev ? {
          ...prev,
          status: 'complete',
          next_expected_byte: 0
        } : null)
      } else if (isPaused) {
        saveUploadState()
      }
    } catch (err) {
      handleError(err, 'Upload failed')
      saveUploadState()
    } finally {
      if (!isPaused) {
        setIsUploading(false)
        setIsResuming(false)
      }
    }
  }

  const handlePauseResume = () => {
    if (isPaused) {
      setIsPaused(false)
      uploadFile()
    } else {
      setIsPaused(true)
      activeChunk.current?.abort()
      saveUploadState()
    }
  }

  const saveUploadState = () => {
    if (!file || !metadata) return

    const uploadState = {
      fileId,
      metadata: {
        ...metadata,
        received_bytes: Math.floor((progress / 100) * file.size),
        next_expected_byte: metadata.next_expected_byte,
        last_updated: new Date().toISOString()
      }
    }

    localStorage.setItem(`upload_${file.name}`, JSON.stringify(uploadState))
  }

  const downloadFile = (): void => {
    if (!token || !file || progress !== 100) {
      setError('Cannot download: File not fully uploaded')
      return
    }

    const downloadUrl = `http://localhost:8080/download/${fileId}`
    const link = document.createElement('a')
    link.href = downloadUrl
    link.setAttribute('download', file.name)
    link.setAttribute('target', '_blank')
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const checkStatus = async (): Promise<void> => {
    if (!fileId || !token) {
      setMetadata({
        file_id: fileId,
        status: 'not_found',
        received_bytes: 0,
        total_bytes: 0,
        next_expected_byte: 0,
        checksum: 0,
        last_updated: new Date().toISOString()
      })
      return
    }

    try {
      setError('')
      const { data } = await axios.get<FileMetadata>(
        `http://localhost:8080/status/${fileId}`,
        { 
          headers: { Authorization: `Bearer ${token}` },
          withCredentials: true
        }
      )

      setMetadata(data)
      if (file) {
        setProgress((data.received_bytes / file.size) * 100)
      }
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 404) {
        setMetadata({
          file_id: fileId,
          status: file ? 'not_uploaded' : 'not_found',
          received_bytes: 0,
          total_bytes: file?.size || 0,
          next_expected_byte: 0,
          checksum: 0,
          last_updated: new Date().toISOString()
        })
      } else {
        handleError(err, 'Failed to check upload status')
      }
    }
  }

  const handleError = (err: unknown, defaultMsg: string): void => {
    if (axios.isAxiosError(err)) {
      const serverError = err.response?.data?.error || err.response?.data?.message
      const message = serverError || err.message || defaultMsg
      setError(`Error: ${message}`)
      
      if (err.response?.status === 401) {
        setToken('')
      }
    } else if (err instanceof Error) {
      setError(`Error: ${err.message}`)
    } else {
      setError(`Error: ${defaultMsg}`)
    }
  }

  const ResumePrompt = () => (
    <motion.div 
      className="resume-prompt bg-amber-500/10 border border-amber-500/30 p-4 rounded-lg mb-4"
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      data-testid="resume-prompt"
    >
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-medium text-amber-300">Incomplete Upload Found</h3>
          <p className="text-sm text-amber-200">
            {metadata?.received_bytes && file 
              ? `${formatFileSize(metadata.received_bytes)} of ${formatFileSize(file.size)} uploaded`
              : 'Partial upload detected'}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => {
              setIsResuming(true)
              setShowResumePrompt(false)
              uploadFile()
            }}
            className="px-3 py-1 bg-amber-600 hover:bg-amber-700 rounded text-sm"
            data-testid="resume-button"
          >
            Resume
          </button>
          <button
            onClick={() => {
              localStorage.removeItem(`upload_${file?.name}`)
              setShowResumePrompt(false)
              setMetadata(null)
              setProgress(0)
              if (fileInputRef.current) fileInputRef.current.value = ''
            }}
            className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm"
            data-testid="restart-button"
          >
            Start New
          </button>
        </div>
      </div>
    </motion.div>
  )

  const UploadControls = () => (
    <div className="flex items-center gap-3 mt-4">
      <button
        onClick={uploadFile}
        disabled={!file || isUploading}
        className={`flex-1 py-2 px-4 rounded-lg flex items-center justify-center ${
          (!file || isUploading)
            ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
            : 'bg-gradient-to-r from-teal-500 to-indigo-600 text-white shadow-md hover:shadow-lg'
        }`}
        data-testid="upload-button"
      >
        {isUploading ? (
          <span className="flex items-center">
            <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            {isResuming ? 'Resuming...' : 'Uploading...'}
          </span>
        ) : isResuming ? 'Resume Upload' : 'Start Upload'}
      </button>
      
      {isUploading && (
        <>
          <button
            onClick={handlePauseResume}
            className={`p-2 rounded-full ${
              isUploading ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-800 cursor-not-allowed'
            }`}
            title={isPaused ? 'Resume' : 'Pause'}
            data-testid="pause-resume-button"
          >
            {isPaused ? <FiPlay size={18} /> : <FiPause size={18} />}
          </button>
          
          {retryCount > 0 && (
            <div className="flex items-center text-amber-400 text-sm">
              <FiRotateCw className="mr-1" />
              <span>Retry {retryCount}/{MAX_RETRIES}</span>
            </div>
          )}
        </>
      )}
    </div>
  )

  const ProgressDisplay = () => (
    <div className="mt-4 space-y-2" data-testid="progress-display">
      <div className="flex justify-between text-xs text-gray-400">
        <span>{progress.toFixed(1)}% Complete</span>
        <span>{speed} • {timeRemaining} remaining</span>
      </div>
      <div className="w-full bg-gray-700 rounded-full h-2.5">
        <div 
          className="bg-gradient-to-r from-teal-400 to-indigo-500 h-2.5 rounded-full transition-all duration-300" 
          style={{ width: `${progress}%` }}
          data-testid="progress-bar"
        ></div>
      </div>
      <div className="flex justify-between text-xs text-gray-400">
        <span data-testid="bytes-uploaded">
          {formatFileSize(file?.size ? (file.size * progress / 100) : 0)}
        </span>
        <span data-testid="total-bytes">
          {formatFileSize(file?.size || 0)}
        </span>
      </div>
    </div>
  )

  const StatusBadge = ({ status }: { status: string }) => {
    const statusConfig = {
      complete: { color: 'bg-emerald-500/20', icon: <FiCheck className="text-emerald-400" size={18} /> },
      partial: { color: 'bg-amber-500/20', icon: <div className="h-2 w-2 bg-amber-400 rounded-full"></div> },
      pending: { color: 'bg-sky-500/20', icon: <div className="h-2 w-2 bg-sky-400 rounded-full"></div> },
      not_found: { color: 'bg-gray-500/20', icon: <div className="h-2 w-2 bg-gray-400 rounded-full"></div> },
      not_uploaded: { color: 'bg-orange-500/20', icon: <div className="h-2 w-2 bg-orange-400 rounded-full"></div> }
    }

    const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.pending

    return (
      <div className={`p-1 rounded-full mr-2 ${config.color}`}>
        {config.icon}
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 to-gray-800 text-gray-100 p-4">
      <div className="max-w-4xl mx-auto">
        <header className="mb-8 text-center">
          <motion.h1 
            className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-teal-400 to-indigo-500"
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            File Project
          </motion.h1>
          <p className="text-gray-400 mt-2">Secure file transfers with resumable uploads</p>
        </header>

        {!token ? (
          <motion.div 
            className="bg-gray-800 rounded-xl p-8 shadow-lg border border-gray-700 mb-6"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3 }}
          >
            <div className="flex items-center mb-6">
              <div className="relative">
                <div className="absolute -inset-1 bg-gradient-to-r from-teal-500 to-indigo-600 rounded-lg blur opacity-75"></div>
                <div className="relative px-4 py-2 bg-gray-800 rounded-lg flex items-center">
                  <FiLock className="text-amber-300 mr-2" size={24} />
                  <h2 className="text-xl font-semibold">Login</h2>
                </div>
              </div>
            </div>
            
            <div className="space-y-6">
              <div className="relative group">
                <div className="absolute -inset-0.5 bg-gradient-to-r from-teal-500 to-indigo-600 rounded-lg blur opacity-75 group-hover:opacity-100 transition duration-200"></div>
                <div className="relative flex items-center bg-gray-800 rounded-lg px-4 py-2">
                  <FiUser className="text-teal-400 mr-2" size={18} />
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full bg-transparent border-none focus:outline-none text-white placeholder-gray-400"
                    placeholder="Enter username"
                    onKeyDown={(e) => e.key === 'Enter' && login()}
                    data-testid="username-input"
                  />
                </div>
              </div>

              <div className="relative group">
                <div className="absolute -inset-0.5 bg-gradient-to-r from-teal-500 to-indigo-600 rounded-lg blur opacity-75 group-hover:opacity-100 transition duration-200"></div>
                <div className="relative flex items-center bg-gray-800 rounded-lg px-4 py-2">
                  <FiKey className="text-indigo-400 mr-2" size={18} />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-transparent border-none focus:outline-none text-white placeholder-gray-400"
                    placeholder="Enter password"
                    onKeyDown={(e) => e.key === 'Enter' && login()}
                    data-testid="password-input"
                  />
                </div>
              </div>

              <motion.button
                onClick={login}
                className="w-full py-3 px-4 rounded-lg flex items-center justify-center bg-gradient-to-r from-teal-500 to-indigo-600 text-white shadow-lg hover:shadow-xl transition-all relative overflow-hidden"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                disabled={isLoggingIn}
                data-testid="login-button"
              >
                {isLoggingIn ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Authenticating...
                  </>
                ) : (
                  <>
                    <span className="relative z-10">Dashboard</span>
                    <span className="absolute inset-0 bg-gradient-to-r from-teal-600 to-indigo-700 opacity-0 hover:opacity-100 transition-opacity duration-300"></span>
                  </>
                )}
              </motion.button>

              <div className="text-center text-xs text-gray-400 mt-4">
                <p>Secure connection encrypted</p>
                <div className="flex items-center justify-center mt-2">
                  <div className="h-2 w-2 bg-emerald-400 rounded-full mr-1"></div>
                  <span>End-to-end encrypted</span>
                </div>
              </div>
            </div>
          </motion.div>
        ) : (
          <>
            <div className="bg-gray-800 rounded-xl p-6 shadow-lg border border-gray-700 mb-6">
              <div className="flex justify-between items-center">
                <div className="flex items-center">
                  <FiUnlock className="text-emerald-400 mr-2" size={20} />
                  <h2 className="text-xl font-semibold">Authenticated</h2>
                </div>
                <button
                  onClick={logout}
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg shadow hover:shadow-lg transition-all"
                  data-testid="logout-button"
                >
                  Logout
                </button>
              </div>
              <div className="mt-3 text-sm text-gray-400">
                Logged in as: <span className="font-medium" data-testid="logged-in-user">{username}</span>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Upload Card */}
              <div className="bg-gray-800 rounded-xl p-6 shadow-lg border border-gray-700 lg:col-span-2">
                <div className="flex items-center mb-4">
                  <FiUpload className="text-teal-400 mr-2" size={20} />
                  <h2 className="text-xl font-semibold">File Upload</h2>
                </div>

                {showResumePrompt && <ResumePrompt />}

                <div className="space-y-4">
                  <div>
                    <label className="block mb-1 text-sm text-gray-400">Select file</label>
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleFileChange}
                      className="block w-full text-sm text-gray-300 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-gray-700 file:text-white hover:file:bg-gray-600 transition-colors cursor-pointer"
                      disabled={isUploading}
                      data-testid="file-input"
                    />
                  </div>
                  
                  {file && (
                    <div className="text-sm text-gray-400" data-testid="file-info">
                      <div className="grid grid-cols-2 gap-2">
                        <div>Filename:</div>
                        <div className="font-medium truncate" data-testid="filename">{file.name}</div>
                        <div>Size:</div>
                        <div className="font-medium" data-testid="filesize">{formatFileSize(file.size)}</div>
                        {metadata?.checksum && (
                          <>
                            <div>Checksum:</div>
                            <div className="font-mono text-xs" data-testid="checksum">
                              {metadata.checksum.toString(16).slice(0, 8)}...
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  )}

                  <UploadControls />

                  {(progress > 0 || isUploading) && <ProgressDisplay />}
                </div>
              </div>

              {/* Status Card */}
              <div className="bg-gray-800 rounded-xl p-6 shadow-lg border border-gray-700 lg:col-span-3">
                <div className="flex items-center mb-4">
                  {metadata && <StatusBadge status={metadata.status} />}
                  <h2 className="text-xl font-semibold">Transfer Status</h2>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-4">
                    <div className="flex gap-4">
                      <button
                        onClick={checkStatus}
                        className="flex-1 py-2 px-4 rounded-lg flex items-center justify-center bg-gray-700 hover:bg-gray-600 text-white transition-all"
                        data-testid="refresh-status-button"
                      >
                        Refresh Status
                      </button>
                      <button
                        onClick={downloadFile}
                        className={`flex-1 py-2 px-4 rounded-lg flex items-center justify-center transition-all ${
                          progress === 100 && file
                            ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-md hover:shadow-lg cursor-pointer'
                            : 'bg-gray-700 text-gray-500 cursor-not-allowed'
                        }`}
                        disabled={progress !== 100 || !file}
                        data-testid="download-button"
                      >
                        <FiDownload className="mr-2" />
                        Download
                      </button>
                    </div>
                    
                    {metadata ? (
                      <div className="bg-gray-700/50 rounded-lg p-4" data-testid="metadata-display">
                        <div className="grid grid-cols-2 gap-3 text-sm">
                          <div className="text-gray-400">Status:</div>
                          <div className="font-medium capitalize flex items-center">
                            <span className={`inline-block w-2 h-2 rounded-full mr-2 ${
                              metadata.status === 'complete' ? 'bg-emerald-400' : 
                              metadata.status === 'partial' ? 'bg-amber-400' : 
                              metadata.status === 'not_found' ? 'bg-gray-400' :
                              metadata.status === 'not_uploaded' ? 'bg-orange-400' : 'bg-sky-400'
                            }`}></span>
                            {metadata.status === 'not_uploaded' ? 'ready for upload' : metadata.status}
                          </div>
                          <div className="text-gray-400">Progress:</div>
                          <div>
                            {metadata.status === 'not_found' ? 'N/A' : 
                             metadata.status === 'not_uploaded' ? `0 / ${formatFileSize(metadata.total_bytes)}` :
                             `${formatFileSize(metadata.received_bytes)} / ${formatFileSize(metadata.total_bytes)}`}
                          </div>
                          <div className="text-gray-400">Next Byte:</div>
                          <div data-testid="next-byte">
                            {metadata.status === 'not_found' || metadata.status === 'not_uploaded' ? 'N/A' : metadata.next_expected_byte.toLocaleString()}
                          </div>
                          <div className="text-gray-400">Checksum:</div>
                          <div className="font-mono text-xs" data-testid="full-checksum">
                            {metadata.checksum ? `0x${metadata.checksum.toString(16)}` : 'N/A'}
                          </div>
                          <div className="text-gray-400">Last Updated:</div>
                          <div data-testid="last-updated">
                            {new Date(metadata.last_updated).toLocaleString()}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="bg-gray-700/50 rounded-lg p-4 text-center text-gray-400">
                        No file selected or status checked
                      </div>
                    )}
                  </div>

                  <div className="bg-gray-700/30 rounded-lg p-4 border border-gray-700 flex flex-col">
                    <h3 className="text-sm font-medium text-gray-400 mb-2">Transfer Log</h3>
                    <div className="flex-1 bg-gray-800/50 rounded p-3 text-xs font-mono overflow-auto max-h-40" data-testid="transfer-log">
                      {file ? (
                        <>
                          <p className="text-emerald-400">[System] File selected: {file.name} ({formatFileSize(file.size)})</p>
                          {isResuming && (
                            <p className="text-amber-400">[System] Resuming upload from byte {metadata?.next_expected_byte}</p>
                          )}
                          {metadata?.status === 'not_uploaded' && (
                            <p className="text-orange-400">[System] File ready for upload</p>
                          )}
                          {progress > 0 && (
                            <>
                              <p className="text-sky-400">[Upload] Initialized transfer</p>
                              <p className="text-sky-400">[Upload] Progress: {progress.toFixed(1)}%</p>
                            </>
                          )}
                          {retryCount > 0 && (
                            <p className="text-amber-400">[System] Retrying chunk (attempt {retryCount}/{MAX_RETRIES})</p>
                          )}
                          {progress === 100 && (
                            <p className="text-emerald-400">[System] Upload completed successfully</p>
                          )}
                          {isPaused && (
                            <p className="text-gray-400">[System] Upload paused at {progress.toFixed(1)}%</p>
                          )}
                        </>
                      ) : (
                        <p className="text-gray-500">No active file transfer</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Error Notification */}
        {error && (
          <div className="fixed bottom-4 right-4 w-full max-w-md" data-testid="error-notification">
            <div className="bg-rose-900/80 border border-rose-700 text-rose-100 p-4 rounded-lg shadow-lg flex items-start">
              <FiAlertCircle className="flex-shrink-0 mt-0.5 mr-3 text-rose-300" size={18} />
              <div>
                <p className="font-medium">{error}</p>
                {error.includes('401') && (
                  <button 
                    onClick={() => setToken('')}
                    className="mt-1 text-sm text-rose-300 underline hover:text-rose-200"
                    data-testid="reauthenticate-button"
                  >
                    Re-authenticate
                  </button>
                )}
              </div>
              <button 
                onClick={() => setError('')}
                className="ml-auto text-rose-300 hover:text-white"
                data-testid="dismiss-error-button"
              >
                &times;
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}