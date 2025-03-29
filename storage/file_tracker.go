package storage

import (
	"sync"
	"time"
)

type FileStatus struct {
	FileID           string    `json:"file_id"`
	Status           string    `json:"status"`
	ReceivedBytes    int64     `json:"received_bytes"`
	TotalBytes       int64     `json:"total_bytes"`
	NextExpectedByte int64     `json:"next_expected_byte"`
	StorageLocation  string    `json:"storage_location"`
	LastUpdated      time.Time `json:"last_updated"`
}

type FileTracker struct {
	sync.RWMutex
	Files map[string]*FileStatus
}

var FileTrackerInstance = FileTracker{Files: make(map[string]*FileStatus)}
