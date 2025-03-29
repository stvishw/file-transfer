package storage

import (
	"sync"
)

type ChunkStorage struct {
	sync.RWMutex
	Chunks map[string]map[int64][]byte
}

var ChunkStorageInstance = ChunkStorage{Chunks: make(map[string]map[int64][]byte)}
