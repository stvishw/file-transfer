package main

import (
	"fmt"
	"log"
	"project_10/routes"
)

func main() {
	router := routes.SetupRouter()

	fmt.Println("Server running on port 8080...")
	err := router.Run(":8080")
	if err != nil {
		log.Fatal("Failed to start server:", err)
	}
}
