package samplers

// Recorder receives sampled metric values from the samplers.
type Recorder func(metric string, value float64)
