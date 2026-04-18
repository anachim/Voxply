use nnnoiseless::DenoiseState;

const RNNOISE_FRAME_SIZE: usize = DenoiseState::FRAME_SIZE;

pub struct Denoiser {
    state: Box<DenoiseState<'static>>,
    input_buf: Vec<f32>,
    output_frame: Vec<f32>,
}

impl Denoiser {
    pub fn new() -> Self {
        Self {
            state: DenoiseState::new(),
            input_buf: Vec::with_capacity(RNNOISE_FRAME_SIZE),
            output_frame: vec![0.0f32; RNNOISE_FRAME_SIZE],
        }
    }

    pub fn process(&mut self, samples: &[f32]) -> Vec<f32> {
        self.input_buf.extend_from_slice(samples);
        let mut output = Vec::new();

        while self.input_buf.len() >= RNNOISE_FRAME_SIZE {
            let frame: Vec<f32> = self.input_buf.drain(..RNNOISE_FRAME_SIZE).collect();
            self.state.process_frame(&mut self.output_frame, &frame);
            output.extend_from_slice(&self.output_frame);
        }

        output
    }
}
