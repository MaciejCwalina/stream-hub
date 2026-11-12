package samplers

import (
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var sanitizeRe = regexp.MustCompile(`[^a-z0-9]+`)

// gpuNames maps nvidia-smi UUIDs to friendly card names from the textfile
// collector (gpu_card_info{uuid="...",card="GPU0 ASUS Dual"}).
func loadGPUNames() map[string]string {
	names := map[string]string{}
	data, err := os.ReadFile("/var/lib/node_exporter/textfile/gpu_cards.prom")
	if err != nil {
		return names
	}

	re := regexp.MustCompile(`gpu_card_info\{uuid="([^"]+)",card="([^"]+)"\}`)
	for _, match := range re.FindAllSubmatch(data, -1) {
		names[string(match[1])] = strings.ToLower(strings.TrimSpace(string(match[2])))
	}

	return names
}

// GPU samples nvidia-smi and records per-card metrics.
func GPU(recorder Recorder, interval time.Duration) {
	names := loadGPUNames()
	for {
		time.Sleep(interval)
		out, err := exec.Command("nvidia-smi",
			"--query-gpu=uuid,name,temperature.gpu,clocks.current.memory,power.draw,utilization.gpu",
			"--format=csv,noheader,nounits").Output()
		if err != nil {
			continue
		}

		lines := strings.Split(strings.TrimSpace(string(out)), "\n")
		for index, line := range lines {
			fields := strings.Split(line, ",")
			if len(fields) < 6 {
				continue
			}

			uuid := strings.ToLower(strings.TrimSpace(fields[0]))
			uuid = strings.TrimPrefix(uuid, "gpu-")
			card := fmt.Sprintf("gpu%d", index)
			if friendly, ok := names[uuid]; ok {
				card = sanitizeRe.ReplaceAllString(friendly, "_")
			} else {
				card += "_" + sanitizeRe.ReplaceAllString(strings.ToLower(fields[1]), "_")
			}

			values := []float64{}
			for _, field := range fields[2:] {
				value, err := strconv.ParseFloat(strings.TrimSpace(field), 64)
				if err != nil {
					values = nil
					break
				}

				values = append(values, value)
			}

			if len(values) != 4 {
				continue
			}

			recorder(card+".temp_c", values[0])
			recorder(card+".mem_clock_mhz", values[1]/1000.0) // nvidia-smi reports kHz
			recorder(card+".power_w", values[2])
			recorder(card+".util_pct", values[3])
		}
	}
}
